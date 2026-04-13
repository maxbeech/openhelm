import { describe, it, expect, vi } from "vitest";
import { Vad } from "../src/voice/vad.js";
import { WHISPER_SAMPLE_RATE } from "../src/voice/audio-utils.js";

function makeSilence(durationMs: number): Float32Array {
  return new Float32Array(Math.floor(WHISPER_SAMPLE_RATE * durationMs / 1000));
}

function makeNoise(durationMs: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(Math.floor(WHISPER_SAMPLE_RATE * durationMs / 1000));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = (Math.random() * 2 - 1) * amplitude;
  }
  return samples;
}

describe("Vad", () => {
  it("does not fire on silence alone", () => {
    const onSpeechEnd = vi.fn();
    const vad = new Vad({ onSpeechEnd, silenceDurationMs: 500 });
    vad.process(makeSilence(1000));
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });

  it("does not fire on speech without trailing silence", () => {
    const onSpeechEnd = vi.fn();
    const vad = new Vad({ onSpeechEnd, silenceDurationMs: 500 });
    vad.process(makeNoise(2000));
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });

  it("fires after speech + silence exceeds threshold", () => {
    const onSpeechEnd = vi.fn();
    const vad = new Vad({
      onSpeechEnd,
      silenceDurationMs: 500,
      minSpeechDurationMs: 100,
      threshold: 0.01,
    });
    // 500ms of speech then 600ms of silence
    vad.process(makeNoise(500));
    vad.process(makeSilence(600));
    expect(onSpeechEnd).toHaveBeenCalledOnce();
  });

  it("does not fire twice — hasFired prevents re-trigger", () => {
    const onSpeechEnd = vi.fn();
    const vad = new Vad({
      onSpeechEnd,
      silenceDurationMs: 300,
      minSpeechDurationMs: 100,
    });
    vad.process(makeNoise(400));
    vad.process(makeSilence(400)); // trigger
    vad.process(makeSilence(400)); // should not re-trigger
    expect(onSpeechEnd).toHaveBeenCalledOnce();
  });

  it("does not fire if speech is too short (below minSpeechDurationMs)", () => {
    const onSpeechEnd = vi.fn();
    const vad = new Vad({
      onSpeechEnd,
      silenceDurationMs: 200,
      minSpeechDurationMs: 500,
      threshold: 0.01,
    });
    // Only 100ms of speech (below 500ms minimum)
    vad.process(makeNoise(100));
    vad.process(makeSilence(300));
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });

  it("reset() allows re-triggering", () => {
    const onSpeechEnd = vi.fn();
    const vad = new Vad({
      onSpeechEnd,
      silenceDurationMs: 200,
      minSpeechDurationMs: 100,
    });
    vad.process(makeNoise(300));
    vad.process(makeSilence(300));
    expect(onSpeechEnd).toHaveBeenCalledOnce();

    vad.reset();
    vad.process(makeNoise(300));
    vad.process(makeSilence(300));
    expect(onSpeechEnd).toHaveBeenCalledTimes(2);
  });

  it("hasFired returns false initially", () => {
    const vad = new Vad({ onSpeechEnd: vi.fn() });
    expect(vad.hasFired).toBe(false);
  });

  it("hasFired returns true after firing", () => {
    const vad = new Vad({
      onSpeechEnd: vi.fn(),
      silenceDurationMs: 200,
      minSpeechDurationMs: 100,
    });
    vad.process(makeNoise(300));
    vad.process(makeSilence(300));
    expect(vad.hasFired).toBe(true);
  });
});
