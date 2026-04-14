/**
 * Local TTS engine manager.
 * Supports Piper (default, ships with app) as the initial engine.
 * Kokoro and Coqui XTTS v2 are stubs for Phase 3.
 *
 * Piper CLI: `piper --model <model.onnx> --output-raw < <text>`
 * Raw output: signed 16-bit LE PCM at the model's sample rate.
 */

import { spawn } from "child_process";
import { join } from "path";
import { existsSync, statSync, readFileSync, unlinkSync, rmdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import type { SynthesizeOptions, TtsChunk } from "./provider.js";
import type { TtsEngine } from "@openhelm/shared";
import { PIPER_SAMPLE_RATE } from "./audio-utils.js";
import { extractWavPcmFloat32, int16ToFloat32 } from "./pcm-utils.js";

// Resolve piper binary — bundled by Tauri as an externalBin.
// process.argv[1] is the agent script path, so dirname(argv[1]) is the binaries directory.
function getPiperBinaryPath(): string {
  const agentDir = join(process.argv[1] ?? "", "..");
  const candidates = [
    join(agentDir, "piper"),                                         // next to agent binary (production + dev)
    join(agentDir, "piper-aarch64-apple-darwin"),                    // Tauri externalBin suffix variant
    join(agentDir, "piper-x86_64-apple-darwin"),
    "/usr/local/bin/piper",
    "/opt/homebrew/bin/piper",
    join(process.env.HOME ?? "~", ".openhelm", "bin", "piper"),
  ];
  for (const p of candidates) {
    try {
      const s = statSync(p);
      if (s.isFile() && s.size > 0) return p; // skip 0-byte Tauri externalBin stubs
    } catch { /* not found */ }
  }
  // No real piper binary found — return sentinel so caller falls back to say
  return "";
}

function getPiperModelPath(voice: string): string {
  const modelDir = join(process.execPath, "..", "..", "Resources", "piper-voices");
  const modelFile = `${voice}.onnx`;
  const fullPath = join(modelDir, modelFile);
  if (existsSync(fullPath)) return fullPath;
  // Fallback for dev
  const devPath = join(process.cwd(), "..", "src-tauri", "piper-voices", modelFile);
  if (existsSync(devPath)) return devPath;
  return fullPath; // return expected path even if absent
}

const DEFAULT_PIPER_VOICE = "en_US-lessac-medium";


export class LocalTts {
  private readonly engine: TtsEngine;

  constructor(engine: TtsEngine) {
    this.engine = engine;
  }

  async synthesize(
    text: string,
    opts: SynthesizeOptions,
    onChunk: (chunk: TtsChunk) => void,
  ): Promise<void> {
    switch (this.engine) {
      case "piper":
        return this.synthesizePiper(text, opts, onChunk);
      case "kokoro":
        // Phase 3 placeholder: fall back to piper until implemented
        console.error("[voice/tts] kokoro not yet implemented, using piper");
        return this.synthesizePiper(text, opts, onChunk);
      case "coqui-xtts":
        // Phase 3 placeholder: fall back to piper until implemented
        console.error("[voice/tts] coqui-xtts not yet implemented, using piper");
        return this.synthesizePiper(text, opts, onChunk);
    }
  }

  private synthesizePiper(
    text: string,
    opts: SynthesizeOptions,
    onChunk: (chunk: TtsChunk) => void,
  ): Promise<void> {
    const binPath = getPiperBinaryPath();
    // No valid piper binary — skip straight to say
    if (!binPath) {
      console.error("[voice/tts] piper not available, using macOS say");
      return this.synthesizeSay(text, opts, onChunk);
    }
    return new Promise((resolve, reject) => {
      const voice = opts.voice ?? DEFAULT_PIPER_VOICE;
      const modelPath = getPiperModelPath(voice);

      const args = ["--model", modelPath, "--output-raw"];
      if (opts.speed && opts.speed !== 1.0) {
        args.push("--length-scale", String(1 / opts.speed));
      }

      const child = spawn(binPath, args, { stdio: ["pipe", "pipe", "pipe"] });
      let spawnFailed = false;

      child.on("error", (err) => {
        // Piper not available — fall back to macOS say
        spawnFailed = true;
        console.error(`[voice/tts] piper spawn error (${err.message}), falling back to macOS say`);
        this.synthesizeSay(text, opts, onChunk).then(resolve).catch(reject);
      });

      const chunks: Buffer[] = [];

      child.stdout.on("data", (data: Buffer) => {
        chunks.push(data);
        // Stream in ~100ms chunks (100ms @ 22050Hz = ~4410 samples = 8820 bytes)
        const chunkSize = PIPER_SAMPLE_RATE * 2 * 0.1;
        while (chunks.reduce((s, c) => s + c.length, 0) >= chunkSize) {
          const merged = Buffer.concat(chunks.splice(0));
          const floats = int16ToFloat32(merged);
          onChunk({ samples: floats, sampleRate: PIPER_SAMPLE_RATE, final: false });
        }
      });

      child.stderr.on("data", (d: Buffer) => {
        // Piper writes progress to stderr — suppress in production, log in dev
        if (process.env.NODE_ENV !== "production") {
          process.stderr.write(`[piper] ${d}`);
        }
      });

      child.on("close", (code) => {
        if (spawnFailed) return; // already handled by error event → synthesizeSay
        if (code !== 0 && code !== null) {
          // Non-zero exit: reject without emitting a final chunk — the partial
          // audio already streamed via onChunk(final: false) is the best we have.
          reject(new Error(`[voice/tts] piper exited with code ${code}`));
          return;
        }
        // Flush remaining audio only on clean exit
        if (chunks.length > 0) {
          const merged = Buffer.concat(chunks);
          const floats = int16ToFloat32(merged);
          onChunk({ samples: floats, sampleRate: PIPER_SAMPLE_RATE, final: true });
        } else {
          onChunk({ samples: new Float32Array(0), sampleRate: PIPER_SAMPLE_RATE, final: true });
        }
        resolve();
      });

      // Send text to piper via stdin — skip if spawn already failed
      if (!spawnFailed) {
        try {
          child.stdin.write(text);
          child.stdin.end();
        } catch { /* stdin closed if spawn failed — error event will handle it */ }
      }
    });
  }

  /**
   * macOS `say` TTS fallback — always available, no installation needed.
   * Writes LEF32 WAV to a temp file, parses the data chunk, emits Float32 PCM.
   */
  private synthesizeSay(
    text: string,
    opts: SynthesizeOptions,
    onChunk: (chunk: TtsChunk) => void,
  ): Promise<void> {
    const SAY_SAMPLE_RATE = 22_050;
    return new Promise((resolve, reject) => {
      const tmpDir = mkdtempSync(join(tmpdir(), "openhelm-tts-"));
      const outFile = join(tmpDir, "tts.wav");

      const args = ["--data-format=LEF32@22050", "-o", outFile];
      if (opts.voice) args.push("-v", opts.voice);
      args.push("--", text);

      const child = spawn("say", args, { stdio: "ignore" });

      child.on("error", (err) => {
        reject(new Error(`[voice/tts] say command failed: ${err.message}`));
      });

      child.on("close", (code) => {
        try {
          if (code !== 0 && code !== null) {
            throw new Error(`[voice/tts] say exited with code ${code}`);
          }
          const wav = readFileSync(outFile);
          const pcm = extractWavPcmFloat32(wav);
          onChunk({ samples: pcm, sampleRate: SAY_SAMPLE_RATE, final: true });
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          try { unlinkSync(outFile); } catch { /* ignore */ }
          try { rmdirSync(tmpDir); } catch { /* ignore */ }
        }
      });
    });
  }

  dispose(): void {
    // Nothing to clean up (stateless subprocesses per utterance)
  }
}
