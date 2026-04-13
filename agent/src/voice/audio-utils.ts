/**
 * Audio utilities for the voice pipeline.
 * PCM conversion, WAV header construction, base64 encode/decode, resampling.
 * All audio in the pipeline uses 32-bit float PCM at 16kHz mono
 * (Whisper's expected input format).
 */

export const WHISPER_SAMPLE_RATE = 16_000;
export const PIPER_SAMPLE_RATE = 22_050;

/** Decode a base64 string to a Buffer */
export function base64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

/** Encode a Buffer to base64 */
export function bufferToBase64(buf: Buffer): string {
  return buf.toString("base64");
}

/**
 * Convert a base64-encoded Float32 PCM payload (from the frontend's
 * AudioWorklet) into a Float32Array ready for Whisper.
 */
export function base64ToFloat32(b64: string): Float32Array {
  const buf = base64ToBuffer(b64);
  const floats = new Float32Array(buf.byteLength / 4);
  for (let i = 0; i < floats.length; i++) {
    floats[i] = buf.readFloatLE(i * 4);
  }
  return floats;
}

/** Convert a Float32Array to a base64 string for IPC transport */
export function float32ToBase64(samples: Float32Array): string {
  const buf = Buffer.allocUnsafe(samples.length * 4);
  for (let i = 0; i < samples.length; i++) {
    buf.writeFloatLE(samples[i], i * 4);
  }
  return bufferToBase64(buf);
}

/**
 * Wrap raw PCM samples in a WAV container.
 * @param samples  Float32Array, mono, at `sampleRate` Hz
 */
export function float32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 32; // 32-bit IEEE float
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * 4;
  const headerSize = 44;

  const buf = Buffer.allocUnsafe(headerSize + dataSize);
  let offset = 0;

  // RIFF chunk
  buf.write("RIFF", offset); offset += 4;
  buf.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buf.write("WAVE", offset); offset += 4;

  // fmt sub-chunk
  buf.write("fmt ", offset); offset += 4;
  buf.writeUInt32LE(16, offset); offset += 4;           // sub-chunk size
  buf.writeUInt16LE(3, offset); offset += 2;             // PCM float = type 3
  buf.writeUInt16LE(numChannels, offset); offset += 2;
  buf.writeUInt32LE(sampleRate, offset); offset += 4;
  buf.writeUInt32LE(byteRate, offset); offset += 4;
  buf.writeUInt16LE(blockAlign, offset); offset += 2;
  buf.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data sub-chunk
  buf.write("data", offset); offset += 4;
  buf.writeUInt32LE(dataSize, offset); offset += 4;

  for (let i = 0; i < samples.length; i++) {
    buf.writeFloatLE(samples[i], offset);
    offset += 4;
  }

  return buf;
}

/**
 * Merge an array of Float32 chunks into a single contiguous Float32Array.
 */
export function mergeFloat32Chunks(chunks: Float32Array[]): Float32Array {
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Float32Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/**
 * Simple linear-interpolation downsampler: e.g. 44100 → 16000.
 * Not high-fidelity, but sufficient for speech recognition.
 */
export function resampleLinear(
  src: Float32Array,
  srcRate: number,
  dstRate: number,
): Float32Array {
  if (srcRate === dstRate) return src;
  const ratio = srcRate / dstRate;
  const dstLen = Math.floor(src.length / ratio);
  const dst = new Float32Array(dstLen);
  for (let i = 0; i < dstLen; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, src.length - 1);
    dst[i] = src[lo] + (src[hi] - src[lo]) * (pos - lo);
  }
  return dst;
}

/** Compute RMS energy of a Float32Array (used by VAD) */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}
