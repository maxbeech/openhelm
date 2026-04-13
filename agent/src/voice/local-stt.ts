/**
 * Local STT using smart-whisper (whisper.cpp Node.js bindings).
 *
 * Model downloaded on first use to ~/.openhelm/models/whisper-<model>.bin.
 * Default model: base.en (~142MB) — good balance of speed and accuracy.
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { VoiceProvider, SynthesizeOptions, TtsChunk, TranscribeResult } from "./provider.js";
import type { TtsEngine } from "@openhelm/shared";
import { LocalTts } from "./local-tts.js";

const MODELS_DIR = join(homedir(), ".openhelm", "models");
const DEFAULT_WHISPER_MODEL = "base.en";

// Whisper model URLs (ggml format, from Hugging Face)
const WHISPER_MODEL_URLS: Record<string, string> = {
  "tiny.en": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
  "base.en": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
  "small.en": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
};

function getModelPath(modelName: string): string {
  if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true });
  return join(MODELS_DIR, `ggml-${modelName}.bin`);
}

async function downloadModel(modelName: string): Promise<string> {
  const modelPath = getModelPath(modelName);
  if (existsSync(modelPath)) return modelPath;

  const url = WHISPER_MODEL_URLS[modelName];
  if (!url) throw new Error(`Unknown whisper model: ${modelName}. Available: ${Object.keys(WHISPER_MODEL_URLS).join(", ")}`);

  console.error(`[voice/stt] downloading whisper model ${modelName} from ${url}...`);

  // Dynamic import of built-in fetch (Node 18+)
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download model ${modelName}: HTTP ${response.status}`);
  if (!response.body) throw new Error("Response has no body");

  const { createWriteStream } = await import("fs");
  const { Readable } = await import("stream");
  const { pipeline } = await import("stream/promises");

  const tmpPath = modelPath + ".tmp";
  const writeStream = createWriteStream(tmpPath);
  await pipeline(Readable.fromWeb(response.body as any), writeStream);

  const { rename } = await import("fs/promises");
  await rename(tmpPath, modelPath);
  console.error(`[voice/stt] whisper model saved: ${modelPath}`);
  return modelPath;
}

/**
 * LocalVoiceProvider: whisper.cpp STT + selected TTS engine.
 * All TTS engines are managed by LocalTts.
 */
export class LocalVoiceProvider implements VoiceProvider {
  private whisper: any | null = null;
  private whisperLoading: Promise<any> | null = null;
  private tts: LocalTts;
  private readonly ttsEngine: TtsEngine;

  constructor(ttsEngine: TtsEngine) {
    this.ttsEngine = ttsEngine;
    this.tts = new LocalTts(ttsEngine);
  }

  /** Eagerly load the whisper model (called at startup to minimize latency) */
  async preload(): Promise<void> {
    await this.getWhisper();
  }

  private async getWhisper(): Promise<any> {
    if (this.whisper) return this.whisper;
    if (this.whisperLoading) return this.whisperLoading;

    this.whisperLoading = (async () => {
      const modelPath = await downloadModel(DEFAULT_WHISPER_MODEL);

      // smart-whisper 0.8.x: named export `Whisper`
      let WhisperClass: any;
      try {
        const mod = await import("smart-whisper");
        WhisperClass = mod.Whisper ?? mod.default ?? mod;
      } catch (err) {
        throw new Error(
          `smart-whisper not installed. Run: cd agent && npm install smart-whisper\n${err}`,
        );
      }

      // Constructor: new Whisper(modelPath, { gpu: true })
      // gpu: true requests Metal acceleration on macOS — smart-whisper logs
      // whether it actually activated. If the timing below is >1s per ~5s of
      // audio, Metal is likely not active and the build lacks Metal support.
      console.error("[voice/stt] loading whisper model (gpu: true):", modelPath);
      const instance = new WhisperClass(modelPath, { gpu: true });
      this.whisper = instance;
      console.error("[voice/stt] whisper model ready:", modelPath);
      return instance;
    })();

    return this.whisperLoading;
  }

  /** Transcribe Float32 PCM (16kHz mono) using smart-whisper 0.8.x API */
  async transcribe(pcm: Float32Array): Promise<TranscribeResult> {
    const whisper = await this.getWhisper();

    // Time the transcription to help diagnose whether GPU acceleration is active.
    // On Apple Silicon with Metal: expect ~200-500ms for a 5-10s utterance.
    // On CPU-only: expect ~1000-3000ms for the same.
    const t0 = Date.now();

    // smart-whisper 0.8.x: transcribe(pcm, opts) → task; await task.result for segments
    const task = await whisper.transcribe(pcm, { language: "en" });
    const segments: Array<{ text: string }> = await task.result;

    const durationSec = (pcm.length / 16000).toFixed(1);
    const inferMs = Date.now() - t0;
    console.error(`[voice/stt] transcribed ${durationSec}s audio in ${inferMs}ms`);

    const text = Array.isArray(segments)
      ? segments.map((s) => s.text).join(" ").trim()
      : String(segments ?? "").trim();

    return { text, confidence: 1 };
  }

  async synthesize(
    text: string,
    opts: SynthesizeOptions,
    onChunk: (chunk: TtsChunk) => void,
  ): Promise<void> {
    return this.tts.synthesize(text, opts, onChunk);
  }

  dispose(): void {
    this.tts.dispose();
    this.whisper = null;
    this.whisperLoading = null;
  }
}
