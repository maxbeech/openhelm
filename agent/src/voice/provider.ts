/**
 * VoiceProvider abstraction.
 *
 * The interface is intentionally minimal so a CloudVoiceProvider (Plan 13b)
 * can be dropped in without changing any calling code.
 */

import type { TtsEngine } from "@openhelm/shared";

export interface TranscribeResult {
  text: string;
  /** Confidence 0–1 if available from the engine, otherwise 1 */
  confidence: number;
}

export interface SynthesizeOptions {
  /**  Voice model ID or name (engine-specific) */
  voice?: string;
  /** Playback speed multiplier (default 1.0) */
  speed?: number;
}

export interface TtsChunk {
  /** Raw PCM Float32 samples */
  samples: Float32Array;
  sampleRate: number;
  /** True when this is the last chunk for this utterance */
  final: boolean;
}

export interface VoiceProvider {
  /** Transcribe a complete audio utterance (Float32 PCM, 16kHz mono) to text */
  transcribe(pcm: Float32Array): Promise<TranscribeResult>;

  /** Synthesize text to speech, streaming chunks via the callback */
  synthesize(
    text: string,
    opts: SynthesizeOptions,
    onChunk: (chunk: TtsChunk) => void,
  ): Promise<void>;

  /** Release any resources held (model contexts, child processes, etc.) */
  dispose(): void;
}

// ─── Factory ───

export async function createVoiceProvider(engine: TtsEngine): Promise<VoiceProvider> {
  switch (engine) {
    case "piper": {
      const { LocalVoiceProvider } = await import("./local-stt.js");
      return new LocalVoiceProvider(engine);
    }
    case "kokoro": {
      const { LocalVoiceProvider } = await import("./local-stt.js");
      return new LocalVoiceProvider(engine);
    }
    case "coqui-xtts": {
      const { LocalVoiceProvider } = await import("./local-stt.js");
      return new LocalVoiceProvider(engine);
    }
    default: {
      const { LocalVoiceProvider } = await import("./local-stt.js");
      return new LocalVoiceProvider("piper");
    }
  }
}
