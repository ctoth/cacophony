import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createOfflineNodeCacophony as distMakeOffline } from "../../dist/node.mjs";
import { parseFxToken } from "../../src/cli/commands";
import { bufferStats, renderToBuffer, renderToFile } from "../../src/cli/render";

/** Peak + mean(|x|) over channel 0 (mirrors scripts/node-smoke.mjs peakMean). */
function peakMean(buffer: AudioBuffer): { peak: number; mean: number } {
  const d = new Float32Array(buffer.length);
  buffer.copyFromChannel(d, 0);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    sum += a;
  }
  return { peak, mean: sum / d.length };
}

/**
 * Sum of |x| over channel 0 in the frame window [startFrame, endFrame)
 * (mirrors the reverb-tail-energy measure in spike/play_file.mjs:31-34).
 */
function energyInWindow(buffer: AudioBuffer, startFrame: number, endFrame: number): number {
  const d = new Float32Array(buffer.length);
  buffer.copyFromChannel(d, 0);
  const lo = Math.max(0, Math.floor(startFrame));
  const hi = Math.min(d.length, Math.floor(endFrame));
  let energy = 0;
  for (let i = lo; i < hi; i++) energy += Math.abs(d[i]);
  return energy;
}

/**
 * Coarse high-frequency energy over channel 0: the first-difference L1 norm
 * sum(|x[i] - x[i-1]|). A low-pass filter removes HF harmonics, so this drops
 * even when mean(|x|) does not — the "coarse high-frequency energy measure" the
 * plan allows for the biquad assertion.
 */
function hfEnergy(buffer: AudioBuffer): number {
  const d = new Float32Array(buffer.length);
  buffer.copyFromChannel(d, 0);
  let energy = 0;
  for (let i = 1; i < d.length; i++) energy += Math.abs(d[i] - d[i - 1]);
  return energy;
}

const TEST_OGG = join(__dirname, "..", "..", "test.ogg");

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

/**
 * The fx delta tests render through worklet-backed effects (distortion =
 * waveshaper, reverb = FDN). Those worklets only load against the BUILT bundle,
 * where Vite inlines them as `data:` URLs — under source `?url` resolves to a
 * bare path the Node worklet loader cannot fetch. So these tests inject the
 * built `dist/node.mjs` factory, exactly as scripts/node-smoke.mjs does. (biquad
 * is a native node and would also run under source, but uses the same factory
 * for consistency.) Build dist before running: `npx vite build`.
 */
describe("render-core fx (Stage 2 A/B by render delta, against built dist)", () => {
  const synthParams = {
    source: "synth:220:sawtooth",
    durationSec: 0.3,
    sampleRate: 48000,
    numberOfChannels: 2,
    volume: 0.4,
  };

  it("distortion alters the signal (smoke invariant: peak or mean differs)", async () => {
    const clean = peakMean(await renderToBuffer(synthParams, distMakeOffline));
    const dirty = peakMean(
      await renderToBuffer(
        { ...synthParams, fx: [parseFxToken("distortion:drive=50,shape=tanh")] },
        distMakeOffline,
      ),
    );

    // The smoke-script invariant (scripts/node-smoke.mjs:47): proves the
    // waveshaper worklet data: URL loaded and computed through the CLI path.
    // eslint-disable-next-line no-console
    console.log(
      `[fx distortion] clean={peak:${clean.peak.toFixed(4)},mean:${clean.mean.toFixed(5)}} ` +
        `dirty={peak:${dirty.peak.toFixed(4)},mean:${dirty.mean.toFixed(5)}}`,
    );
    expect(dirty.peak !== clean.peak || dirty.mean !== clean.mean).toBe(true);
  });

  it("FDN reverb rings out a tail in the second after the dry source ends", async () => {
    // test.ogg is ~0.7 s; render source + 1.5 s of headroom so a tail can ring.
    const sr = 48000;
    const sourceDur = 0.72; // a touch over the asset length (~0.7 s)
    const durationSec = sourceDur + 1.5;
    const base = {
      source: TEST_OGG,
      durationSec,
      sampleRate: sr,
      numberOfChannels: 2,
    };

    const clean = await renderToBuffer(base, distMakeOffline);
    const wet = await renderToBuffer({ ...base, fx: [parseFxToken("reverb:decay=2.5,mix=0.6")] }, distMakeOffline);

    // The 1 s window AFTER the dry source ends.
    const tailStart = Math.ceil(sourceDur * sr);
    const tailEnd = tailStart + sr;
    const cleanTail = energyInWindow(clean, tailStart, tailEnd);
    const wetTail = energyInWindow(wet, tailStart, tailEnd);

    // eslint-disable-next-line no-console
    console.log(`[fx reverb] tail energy(1s after source) clean=${cleanTail.toFixed(4)} wet=${wetTail.toFixed(4)}`);

    expect(wetTail).toBeGreaterThan(0);
    expect(wetTail).toBeGreaterThan(cleanTail);
    // The dry render's tail is effectively silent (source already ended).
    expect(cleanTail).toBeLessThan(1);
  });

  it("biquad low-pass reduces high-frequency energy of the sawtooth", async () => {
    const clean = hfEnergy(await renderToBuffer(synthParams, distMakeOffline));
    const lp = hfEnergy(
      await renderToBuffer(
        { ...synthParams, fx: [parseFxToken("biquad:type=lowpass,frequency=400")] },
        distMakeOffline,
      ),
    );

    // eslint-disable-next-line no-console
    console.log(`[fx biquad lowpass] HF energy clean=${clean.toFixed(2)} lp=${lp.toFixed(2)}`);

    // A 400 Hz low-pass on a 220 Hz sawtooth strips the upper harmonics → the
    // first-difference (high-frequency) energy drops.
    expect(lp).toBeLessThan(clean);
  });
});
