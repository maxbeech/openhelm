import { describe, it, expect } from "vitest";
import {
  base64ToFloat32,
  float32ToBase64,
  float32ToWav,
  mergeFloat32Chunks,
  resampleLinear,
  rms,
  WHISPER_SAMPLE_RATE,
} from "../src/voice/audio-utils.js";

describe("base64 round-trip", () => {
  it("encodes and decodes Float32Array losslessly", () => {
    const input = new Float32Array([0.1, 0.5, -0.3, 0.9, -1.0]);
    const b64 = float32ToBase64(input);
    const output = base64ToFloat32(b64);
    expect(output.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(output[i]).toBeCloseTo(input[i], 5);
    }
  });

  it("handles empty array", () => {
    const b64 = float32ToBase64(new Float32Array(0));
    const output = base64ToFloat32(b64);
    expect(output.length).toBe(0);
  });
});

describe("float32ToWav", () => {
  it("produces a valid WAV buffer with RIFF header", () => {
    const samples = new Float32Array(1600); // 100ms at 16kHz
    const wav = float32ToWav(samples, WHISPER_SAMPLE_RATE);
    expect(wav.slice(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.slice(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.slice(12, 16).toString("ascii")).toBe("fmt ");
  });

  it("contains the correct data size in header", () => {
    const samples = new Float32Array(100);
    const wav = float32ToWav(samples, 16000);
    const dataChunkOffset = 40;
    const dataSize = wav.readUInt32LE(dataChunkOffset);
    expect(dataSize).toBe(samples.length * 4); // 32-bit float = 4 bytes
  });
});

describe("mergeFloat32Chunks", () => {
  it("concatenates chunks into a single array", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5]);
    const c = new Float32Array([6]);
    const merged = mergeFloat32Chunks([a, b, c]);
    expect(merged).toEqual(new Float32Array([1, 2, 3, 4, 5, 6]));
  });

  it("handles empty chunks array", () => {
    const merged = mergeFloat32Chunks([]);
    expect(merged.length).toBe(0);
  });
});

describe("resampleLinear", () => {
  it("returns the same array when rates match", () => {
    const input = new Float32Array([0, 0.5, 1.0]);
    const output = resampleLinear(input, 16000, 16000);
    expect(output).toBe(input);
  });

  it("downsamples from 44100 to 16000", () => {
    const inputLen = 44100; // 1 second
    const input = new Float32Array(inputLen).fill(0.5);
    const output = resampleLinear(input, 44100, 16000);
    expect(output.length).toBe(Math.floor(inputLen / (44100 / 16000)));
    // All values should be ~0.5 (constant signal)
    for (const v of output) {
      expect(v).toBeCloseTo(0.5, 4);
    }
  });
});

describe("rms", () => {
  it("returns 0 for silent audio", () => {
    expect(rms(new Float32Array(100))).toBe(0);
  });

  it("returns 1.0 for full-scale sine-like signal", () => {
    const samples = new Float32Array(1000).fill(1.0);
    expect(rms(samples)).toBeCloseTo(1.0, 5);
  });

  it("returns correct RMS for known values", () => {
    // RMS([1, -1, 1, -1]) = 1.0
    const samples = new Float32Array([1, -1, 1, -1]);
    expect(rms(samples)).toBeCloseTo(1.0, 5);
  });

  it("handles empty array", () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });
});
