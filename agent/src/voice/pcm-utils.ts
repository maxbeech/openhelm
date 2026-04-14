/**
 * PCM audio conversion utilities for the voice pipeline.
 */

/**
 * Parse a WAV buffer and extract the PCM data chunk as Float32Array.
 * Handles WAV files output by macOS `say` with LEF32 (32-bit float LE) format.
 */
export function extractWavPcmFloat32(buf: Buffer): Float32Array {
  // Walk RIFF chunks to find "data"
  let offset = 12; // skip RIFF header (4+4+4)
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      const dataStart = offset + 8;
      const dataEnd = Math.min(dataStart + size, buf.length);
      const dataLen = (dataEnd - dataStart) & ~3; // align to 4 bytes
      const floats = new Float32Array(dataLen / 4);
      for (let i = 0; i < floats.length; i++) {
        floats[i] = buf.readFloatLE(dataStart + i * 4);
      }
      return floats;
    }
    offset += 8 + size + (size & 1); // chunks are word-aligned
  }
  return new Float32Array(0);
}

/** Convert signed 16-bit LE PCM buffer to Float32Array */
export function int16ToFloat32(buf: Buffer): Float32Array {
  const out = new Float32Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = buf.readInt16LE(i * 2) / 32768;
  }
  return out;
}
