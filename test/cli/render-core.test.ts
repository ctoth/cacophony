import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { bufferStats, renderToBuffer, renderToFile } from "../../src/cli/render";

/** Re-parse a WAV file's data chunk into channel-0 floats + peak. */
function parseWavPeak(buf: Buffer): { audioFormat: number; numChannels: number; peak: number } {
  expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
  const audioFormat = buf.readUInt16LE(20);
  const numChannels = buf.readUInt16LE(22);
  const bitsPerSample = buf.readUInt16LE(34);
  const blockAlign = buf.readUInt16LE(32);
  const dataLen = buf.readUInt32LE(40);
  const bytesPerSample = bitsPerSample / 8;
  const frames = dataLen / blockAlign;

  let peak = 0;
  let offset = 44; // channel 0 is first sample of each frame
  for (let frame = 0; frame < frames; frame++) {
    let v: number;
    if (audioFormat === 3) {
      v = buf.readFloatLE(offset);
    } else {
      const raw = buf.readInt16LE(offset);
      v = raw < 0 ? raw / 0x8000 : raw / 0x7fff;
    }
    const a = Math.abs(v);
    if (a > peak) peak = a;
    offset += blockAlign;
  }
  return { audioFormat, numChannels, peak };
}

const tmp = mkdtempSync(join(tmpdir(), "caco-cli-render-"));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("render-core (real Node backend)", () => {
  const params = {
    source: "synth:220:sawtooth",
    durationSec: 0.3,
    sampleRate: 48000,
    numberOfChannels: 2,
    volume: 0.5,
  };

  it("renders a synth to a non-silent in-memory buffer (peak > 0.1)", async () => {
    const buffer = await renderToBuffer(params);
    const stats = bufferStats(buffer);

    expect(stats.frames).toBe(Math.ceil(params.sampleRate * params.durationSec));
    expect(stats.peak).toBeGreaterThan(0.1);
    expect(stats.nonSilentSamples).toBeGreaterThan(0);
  });

  it("writes a 32-bit WAV whose decoded peak matches the in-memory render exactly", async () => {
    const out = join(tmp, "synth-32.wav");
    const result = await renderToFile(params, out, 32);

    expect(result.bytesWritten).toBeGreaterThan(44);
    expect(result.stats.peak).toBeGreaterThan(0.1);

    const fileBuf = readFileSync(out);
    const parsed = parseWavPeak(fileBuf);
    expect(parsed.audioFormat).toBe(3);
    expect(parsed.numChannels).toBe(params.numberOfChannels);
    // 32-bit float is lossless: the file peak equals the render peak (fround).
    expect(parsed.peak).toBeCloseTo(result.stats.peak, 6);
  });

  it("writes a 16-bit WAV whose decoded peak matches within quantization", async () => {
    const out = join(tmp, "synth-16.wav");
    const result = await renderToFile(params, out, 16);

    const fileBuf = readFileSync(out);
    const parsed = parseWavPeak(fileBuf);
    expect(parsed.audioFormat).toBe(1);
    expect(parsed.peak).toBeCloseTo(result.stats.peak, 3);
  });
});
