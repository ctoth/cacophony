import { describe, expect, it } from "vitest";
import { type EncodableBuffer, encodeWav } from "../../src/cli/wav";

/**
 * Build an in-memory {@link EncodableBuffer} from per-channel Float32Arrays —
 * no audio context required. Mirrors the AudioBuffer surface the encoder uses.
 */
function makeBuffer(channels: Float32Array[], sampleRate: number): EncodableBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    copyFromChannel(destination, channelNumber) {
      destination.set(channels[channelNumber].subarray(0, destination.length));
    },
  };
}

/** A 0.5 full-scale sine over `frames` samples. */
function halfScaleSine(frames: number, cyclesPerBuffer = 4): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = 0.5 * Math.sin((2 * Math.PI * cyclesPerBuffer * i) / frames);
  }
  return out;
}

function ascii(buf: Buffer, offset: number, len: number): string {
  return buf.toString("ascii", offset, offset + len);
}

/** Re-parse a WAV `Buffer` back into per-channel float arrays. */
function parseWav(buf: Buffer): {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  dataLen: number;
  channels: Float32Array[];
} {
  expect(ascii(buf, 0, 4)).toBe("RIFF");
  expect(ascii(buf, 8, 4)).toBe("WAVE");
  expect(ascii(buf, 12, 4)).toBe("fmt ");
  const audioFormat = buf.readUInt16LE(20);
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const byteRate = buf.readUInt32LE(28);
  const blockAlign = buf.readUInt16LE(32);
  const bitsPerSample = buf.readUInt16LE(34);
  expect(ascii(buf, 36, 4)).toBe("data");
  const dataLen = buf.readUInt32LE(40);

  const bytesPerSample = bitsPerSample / 8;
  const frames = dataLen / blockAlign;
  const channels: Float32Array[] = Array.from(
    { length: numChannels },
    () => new Float32Array(frames),
  );

  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      if (audioFormat === 3) {
        channels[ch][frame] = buf.readFloatLE(offset);
      } else {
        const v = buf.readInt16LE(offset);
        channels[ch][frame] = v < 0 ? v / 0x8000 : v / 0x7fff;
      }
      offset += bytesPerSample;
    }
  }

  return { audioFormat, numChannels, sampleRate, byteRate, blockAlign, bitsPerSample, dataLen, channels };
}

function peak(arr: Float32Array): number {
  let p = 0;
  for (let i = 0; i < arr.length; i++) {
    const a = Math.abs(arr[i]);
    if (a > p) p = a;
  }
  return p;
}

describe("encodeWav", () => {
  const SAMPLE_RATE = 48000;
  const FRAMES = 480;

  it("writes a canonical 16-bit PCM header (mono)", () => {
    const sine = halfScaleSine(FRAMES);
    const wav = encodeWav(makeBuffer([sine], SAMPLE_RATE), { bitDepth: 16 });
    const p = parseWav(wav);

    expect(p.audioFormat).toBe(1);
    expect(p.numChannels).toBe(1);
    expect(p.sampleRate).toBe(SAMPLE_RATE);
    expect(p.bitsPerSample).toBe(16);
    expect(p.blockAlign).toBe(2); // 1 ch * 2 bytes
    expect(p.byteRate).toBe(SAMPLE_RATE * 2);
    expect(p.dataLen).toBe(FRAMES * 2);
    // Header (44) + data == total
    expect(wav.length).toBe(44 + FRAMES * 2);
    // RIFF chunk size == 36 + dataLen
    expect(wav.readUInt32LE(4)).toBe(36 + FRAMES * 2);
  });

  it("writes a canonical 32-bit float header (stereo)", () => {
    const l = halfScaleSine(FRAMES, 4);
    const r = halfScaleSine(FRAMES, 8);
    const wav = encodeWav(makeBuffer([l, r], SAMPLE_RATE), { bitDepth: 32 });
    const p = parseWav(wav);

    expect(p.audioFormat).toBe(3);
    expect(p.numChannels).toBe(2);
    expect(p.sampleRate).toBe(SAMPLE_RATE);
    expect(p.bitsPerSample).toBe(32);
    expect(p.blockAlign).toBe(8); // 2 ch * 4 bytes
    expect(p.byteRate).toBe(SAMPLE_RATE * 8);
    expect(p.dataLen).toBe(FRAMES * 8);
  });

  it("round-trips 32-bit float EXACTLY (reference oracle)", () => {
    const sine = halfScaleSine(FRAMES);
    const wav = encodeWav(makeBuffer([sine], SAMPLE_RATE), { bitDepth: 32 });
    const { channels } = parseWav(wav);

    expect(channels[0].length).toBe(FRAMES);
    for (let i = 0; i < FRAMES; i++) {
      // Float32 storage is exact for a value already produced as Float32.
      expect(channels[0][i]).toBe(Math.fround(sine[i]));
    }
    expect(peak(channels[0])).toBeCloseTo(0.5, 6);
  });

  it("round-trips 16-bit within quantization tolerance", () => {
    const sine = halfScaleSine(FRAMES);
    const wav = encodeWav(makeBuffer([sine], SAMPLE_RATE), { bitDepth: 16 });
    const { channels } = parseWav(wav);

    const tol = 1 / 32768;
    for (let i = 0; i < FRAMES; i++) {
      expect(Math.abs(channels[0][i] - sine[i])).toBeLessThanOrEqual(tol);
    }
    expect(peak(channels[0])).toBeCloseTo(0.5, 3);
  });

  it("clamps 16-bit out-of-range samples to full scale", () => {
    const over = new Float32Array([2.0, -2.0, 0]);
    const wav = encodeWav(makeBuffer([over], SAMPLE_RATE), { bitDepth: 16 });
    // Raw int16 at the data offset: +32767, -32768, 0
    expect(wav.readInt16LE(44)).toBe(0x7fff);
    expect(wav.readInt16LE(46)).toBe(-0x8000);
    expect(wav.readInt16LE(48)).toBe(0);
  });
});
