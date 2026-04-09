/**
 * Energy-based Voice Activity Detection (VAD).
 *
 * Processes 20ms frames, tracks a rolling energy window, and fires
 * `onSpeechEnd` when `silenceDurationMs` of silence has been detected
 * after at least `minSpeechDurationMs` of speech.
 */

import { rms, WHISPER_SAMPLE_RATE } from "./audio-utils.js";

export interface VadOptions {
  /** Minimum RMS energy to classify a frame as speech (0.0–1.0, default 0.01) */
  threshold?: number;
  /** Silence duration before speech end is declared, in ms (default 2000) */
  silenceDurationMs?: number;
  /** Minimum speech before VAD can fire, in ms (default 300) */
  minSpeechDurationMs?: number;
  /** Called once when end-of-speech is detected */
  onSpeechEnd: () => void;
}

const FRAME_MS = 20;

export class Vad {
  private readonly threshold: number;
  private readonly silenceFramesThreshold: number;
  private readonly minSpeechFrames: number;
  private readonly onSpeechEnd: () => void;

  private silenceFrames = 0;
  private speechFrames = 0;
  private speaking = false;
  private fired = false;
  // Accumulates sub-frame samples across calls (AudioWorklet sends 128-sample chunks,
  // but frames are 320 samples at 16kHz — must buffer across multiple calls)
  private leftover: Float32Array = new Float32Array(0);

  constructor(opts: VadOptions) {
    this.threshold = opts.threshold ?? 0.01;
    const silenceMs = opts.silenceDurationMs ?? 2000;
    const minSpeechMs = opts.minSpeechDurationMs ?? 300;
    this.silenceFramesThreshold = Math.ceil(silenceMs / FRAME_MS);
    this.minSpeechFrames = Math.ceil(minSpeechMs / FRAME_MS);
    this.onSpeechEnd = opts.onSpeechEnd;
  }

  /** Feed a chunk of Float32 audio (any length). Split into 20ms frames internally.
   *  Accumulates a leftover buffer so sub-frame chunks (e.g. 128-sample AudioWorklet
   *  blocks) are correctly assembled into 320-sample frames before classification. */
  process(samples: Float32Array): void {
    if (this.fired) return;
    const frameSize = Math.floor(WHISPER_SAMPLE_RATE * FRAME_MS / 1000);

    // Prepend any leftover from the previous call
    let buf: Float32Array;
    if (this.leftover.length > 0) {
      buf = new Float32Array(this.leftover.length + samples.length);
      buf.set(this.leftover, 0);
      buf.set(samples, this.leftover.length);
    } else {
      buf = samples;
    }

    let offset = 0;
    while (offset + frameSize <= buf.length) {
      const frame = buf.subarray(offset, offset + frameSize);
      this.processFrame(frame);
      if (this.fired) return;
      offset += frameSize;
    }

    // Save any remaining samples for the next call
    this.leftover = buf.slice(offset);
  }

  private processFrame(frame: Float32Array): void {
    const energy = rms(frame);
    const isSpeech = energy > this.threshold;

    if (isSpeech) {
      this.speaking = true;
      this.speechFrames++;
      this.silenceFrames = 0;
    } else if (this.speaking) {
      this.silenceFrames++;
      if (
        this.silenceFrames >= this.silenceFramesThreshold &&
        this.speechFrames >= this.minSpeechFrames
      ) {
        this.fired = true;
        this.onSpeechEnd();
      }
    }
  }

  reset(): void {
    this.silenceFrames = 0;
    this.speechFrames = 0;
    this.speaking = false;
    this.fired = false;
    this.leftover = new Float32Array(0);
  }

  /** True if enough speech has accumulated and silence was detected */
  get hasFired(): boolean {
    return this.fired;
  }
}
