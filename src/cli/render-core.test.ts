import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FFT from "fft.js";
import { afterAll, describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "../backend-available";
import type { createOfflineNodeCacophony, decodeAudioFile } from "../node";
import { parseFxToken } from "./commands";
import { bufferStats, type OfflineCacophonyFactory, renderToBuffer, renderToFile } from "./render";
import { replayToBuffer } from "./replay";

/**
 * The worklet-backed fx/spatial/pitch tests run against the BUILT `dist/node.mjs`
 * factory (the worklet bundles are only inlined as `data:` URLs after `vite build`).
 * That module's emitted `.d.ts` types are structurally distinct from — though
 * runtime-equivalent to — the source `../node` exports, so we import the runtime
 * dynamically and re-type the two bindings through their source signatures. This
 * keeps the build artifact out of tsc's `rootDir` program while staying fully
 * typed (no `any`, no suppressions). Build dist before running: `npx vite build`.
 */
// Specifier held in a variable so tsc does not pull the built artifact into its
// `rootDir: ./src` program (which would trip TS6059); the runtime resolves it fine.
const distNodeSpecifier = "../../dist/node.mjs";
const distNode = (await import(distNodeSpecifier)) as {
  createOfflineNodeCacophony: typeof createOfflineNodeCacophony;
  decodeAudioFile: typeof decodeAudioFile;
};
const distMakeOffline: OfflineCacophonyFactory = distNode.createOfflineNodeCacophony;
const distDecode = distNode.decodeAudioFile;

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

const TEST_OGG = join(process.cwd(), "test.ogg");

/** Re-parse a WAV file's data chunk into channel-0 floats + peak. */
function parseWavPeak(buf: Buffer): { audioFormat: number; numChannels: number; peak: number } {
  expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
  const audioFormat = buf.readUInt16LE(20);
  const numChannels = buf.readUInt16LE(22);
  const blockAlign = buf.readUInt16LE(32);
  const dataLen = buf.readUInt32LE(40);
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

// All blocks below render through the real Node backend (built dist); skipped
// when the optional native dep is absent (e.g. Node < 22). See backend-available.ts.
describe.skipIf(!nodeBackendAvailable)("render-core (real Node backend)", () => {
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
describe.skipIf(!nodeBackendAvailable)("render-core fx (Stage 2 A/B by render delta, against built dist)", () => {
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
      await renderToBuffer({ ...synthParams, fx: [parseFxToken("distortion:drive=50,shape=tanh")] }, distMakeOffline),
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

/**
 * RMS of |x| over a single channel of a rendered buffer (per-channel level).
 * Used for the tremolo/autopan assertions where amplitude modulation changes
 * the channel RMS (and, for autopan/stereoPhase, makes L and R diverge).
 */
function channelRms(buffer: AudioBuffer, channel: number): number {
  const d = new Float32Array(buffer.length);
  buffer.copyFromChannel(d, channel);
  let sumSq = 0;
  for (let i = 0; i < d.length; i++) sumSq += d[i] * d[i];
  return Math.sqrt(sumSq / d.length);
}

/**
 * Stage 3 parity gate: every newly-registered effect must provably alter the
 * render. Parametrized table — for each effect, render a deterministic source
 * clean vs wet (injecting the BUILT `dist/node.mjs`, per the standing
 * constraint that worklet `data:` URLs only exist after `vite build`) and
 * assert a non-trivial change with a comment naming the metric.
 *
 * Build dist before running: `npx vite build` then `npm run test`.
 */
describe.skipIf(!nodeBackendAvailable)(
  "render-core fx parity (Stage 3 per-effect render delta, against built dist)",
  () => {
    const EPSILON = 1e-4;
    const synthParams = {
      source: "synth:220:sawtooth",
      durationSec: 0.3,
      sampleRate: 48000,
      numberOfChannels: 2,
      volume: 0.4,
    } as const;

    async function renderWet(fxToken: string): Promise<AudioBuffer> {
      return renderToBuffer({ ...synthParams, fx: [parseFxToken(fxToken)] }, distMakeOffline);
    }

    /**
     * peak/mean-delta effects: dattorro, waveshaper, limiter, gate, phaser, and
     * the modulated-delay family. The metric is max(|Δpeak|, |Δmean|) on channel
     * 0; a genuinely-applied effect moves at least one past EPSILON, a no-op
     * moves neither.
     */
    const peakMeanCases: ReadonlyArray<{ name: string; fx: string }> = [
      // dattorro plate reverb — wet/dry mix changes the channel-0 level.
      { name: "dattorro", fx: "dattorro:decay=0.7,wet=0.5,dry=0.3" },
      // waveshaper tanh drive — hard saturation reshapes peak and mean.
      { name: "waveshaper", fx: "waveshaper:drive=40,shape=tanh" },
      // limiter — low threshold + makeup gain shifts the level.
      { name: "limiter", fx: "limiter:threshold=-30,makeup=12" },
      // gate — high ratio downward expansion below threshold cuts the level.
      { name: "gate", fx: "gate:threshold=-20,ratio=10" },
      // phaser — swept allpass notches change the summed waveform.
      { name: "phaser", fx: "phaser:rate=2,depth=2,mix=1" },
      // modulated-delay family: each preset over the same worklet.
      { name: "chorus", fx: "chorus:rate=1,depth=6,feedback=0.5" },
      { name: "flanger", fx: "flanger:rate=1,depth=4,feedback=0.7,feedforward=0.7" },
      { name: "vibrato", fx: "vibrato:rate=5,depth=4,blend=0,feedforward=1" },
      { name: "doubling", fx: "doubling:delayTime=20,depth=2,blend=0.7,feedforward=0.7" },
      { name: "delay", fx: "delay:delayTime=50,feedback=0.6,blend=0.5,feedforward=0.7" },
    ];

    it.each(peakMeanCases)("$name alters the render (metric: max |Δpeak|,|Δmean| > epsilon)", async ({ name, fx }) => {
      const clean = peakMean(await renderToBuffer(synthParams, distMakeOffline));
      const wet = peakMean(await renderWet(fx));
      const dPeak = Math.abs(wet.peak - clean.peak);
      const dMean = Math.abs(wet.mean - clean.mean);

      // eslint-disable-next-line no-console
      console.log(
        `[fx ${name}] clean={peak:${clean.peak.toFixed(4)},mean:${clean.mean.toFixed(5)}} ` +
          `wet={peak:${wet.peak.toFixed(4)},mean:${wet.mean.toFixed(5)}} ` +
          `Δpeak=${dPeak.toFixed(5)} Δmean=${dMean.toFixed(5)}`,
      );

      expect(Math.max(dPeak, dMean)).toBeGreaterThan(EPSILON);
    });

    /**
     * tremolo — LFO amplitude modulation changes per-channel RMS vs clean.
     * Metric: |ΔRMS| on channel 0 > epsilon.
     */
    it("tremolo modulates amplitude (metric: |ΔchannelRMS| > epsilon)", async () => {
      const clean = channelRms(await renderToBuffer(synthParams, distMakeOffline), 0);
      const wet = channelRms(await renderWet("tremolo:rate=8,depth=1"), 0);

      // eslint-disable-next-line no-console
      console.log(
        `[fx tremolo] clean RMS=${clean.toFixed(5)} wet RMS=${wet.toFixed(5)} Δ=${Math.abs(wet - clean).toFixed(5)}`,
      );

      expect(Math.abs(wet - clean)).toBeGreaterThan(EPSILON);
    });

    /**
     * autopan — a 180° stereoPhase auto-pan swings L and R in anti-phase, so the
     * two channels' RMS diverge. Metric: |RMS(L) − RMS(R)| > epsilon (a no-op
     * keeps the channels identical → near-zero divergence).
     */
    it("autopan diverges L/R channels (metric: |RMS(L) − RMS(R)| > epsilon)", async () => {
      const wet = await renderWet("autopan:rate=6,depth=1,stereoPhase=180");
      const rmsL = channelRms(wet, 0);
      const rmsR = channelRms(wet, 1);
      const divergence = Math.abs(rmsL - rmsR);

      // For contrast, the clean stereo render has near-identical channels.
      const clean = await renderToBuffer(synthParams, distMakeOffline);
      const cleanDivergence = Math.abs(channelRms(clean, 0) - channelRms(clean, 1));

      // eslint-disable-next-line no-console
      console.log(
        `[fx autopan] wet RMS L=${rmsL.toFixed(5)} R=${rmsR.toFixed(5)} divergence=${divergence.toFixed(5)} ` +
          `(clean divergence=${cleanDivergence.toFixed(5)})`,
      );

      expect(divergence).toBeGreaterThan(EPSILON);
    });
  },
);

/** Total energy (Σ x²) over one channel of a buffer. */
function channelEnergy(buffer: AudioBuffer, channel: number): number {
  const d = new Float32Array(buffer.length);
  buffer.copyFromChannel(d, channel);
  let e = 0;
  for (let i = 0; i < d.length; i++) e += d[i] * d[i];
  return e;
}

/**
 * Stage 5: spatial/FOA, pitch-shift, time-stretch, groups, REPL-render replay.
 * All render through the BUILT `dist/node.mjs` (pitch is a phase-vocoder worklet,
 * FOA decoder loads a bundled HRIR; both need the inlined `data:` bundles). Build
 * before test: `npx vite build` then `npm run test`.
 */
describe.skipIf(!nodeBackendAvailable)(
  "render-core Stage 5 (spatial/pitch/stretch/groups/replay, against built dist)",
  () => {
    const sr = 48000;

    it("FOA decode produces L/R asymmetry that FLIPS between +90° and −90°", async () => {
      const dur = 1.0;
      const base = { source: "n/a", durationSec: dur, sampleRate: sr, numberOfChannels: 2 };

      const pos = await renderToBuffer({ ...base, foa: { azimuthDeg: 90 } }, distMakeOffline);
      const neg = await renderToBuffer({ ...base, foa: { azimuthDeg: -90 } }, distMakeOffline);

      const posL = channelEnergy(pos, 0);
      const posR = channelEnergy(pos, 1);
      const negL = channelEnergy(neg, 0);
      const negR = channelEnergy(neg, 1);

      // eslint-disable-next-line no-console
      console.log(
        `[foa] +90 L=${posL.toFixed(3)} R=${posR.toFixed(3)} | -90 L=${negL.toFixed(3)} R=${negR.toFixed(3)}`,
      );

      // Both renders are non-silent and binaurally asymmetric.
      expect(posL + posR).toBeGreaterThan(0);
      expect(Math.abs(posL - posR)).toBeGreaterThan(1);
      expect(Math.abs(negL - negR)).toBeGreaterThan(1);
      // The asymmetry flips: whichever channel is louder at +90 is quieter at -90.
      expect(posL > posR).not.toBe(negL > negR);
    });

    it("pitch-shift ×2 raises the spectral centroid of test.ogg and stays non-silent", async () => {
      const base = { source: TEST_OGG, durationSec: 0.72, sampleRate: sr, numberOfChannels: 2 };
      const plain = await renderToBuffer(base, distMakeOffline);
      const shifted = await renderToBuffer({ ...base, pitch: 2 }, distMakeOffline);

      const cPlain = spectralCentroid(plain, sr);
      const cShift = spectralCentroid(shifted, sr);
      const shiftStats = bufferStats(shifted);

      // eslint-disable-next-line no-console
      console.log(`[pitch x2] centroid plain=${cPlain.toFixed(1)}Hz shifted=${cShift.toFixed(1)}Hz`);

      expect(shiftStats.nonSilentSamples).toBeGreaterThan(0);
      // A +1 octave shift moves spectral energy upward.
      expect(cShift).toBeGreaterThan(cPlain);
    });

    it("time-stretch ×2 roughly doubles the buffer length and stays non-silent", async () => {
      const base = { source: TEST_OGG, durationSec: 1, sampleRate: sr, numberOfChannels: 2 };
      const plain = await renderToBuffer(base, distMakeOffline);
      const stretched = await renderToBuffer({ ...base, stretch: 2 }, distMakeOffline);

      // The source buffer (decoded) drives the stretched length; compare lengths.
      const ratio = stretched.length / plain.length;
      const stats = bufferStats(stretched);

      // eslint-disable-next-line no-console
      console.log(`[stretch x2] plainLen=${plain.length} stretchedLen=${stretched.length} ratio=${ratio.toFixed(3)}`);

      // plain render is sized to durationSec=1s (48000 frames). The stretched render
      // is sized to round(sourceFrames * 2). test.ogg ~0.7s so stretched ≈ 1.4s.
      // Assert the stretched buffer is materially longer than the source content.
      expect(stretched.length).toBeGreaterThan(Math.floor(sr * 1.2));
      expect(stats.nonSilentSamples).toBeGreaterThan(0);
    });

    it("time-stretch ×2 on a decoded buffer is ≈2× the source buffer length", async () => {
      // Directly verify the timeStretchBuffer length contract (round(len*factor))
      // by decoding test.ogg and stretching it through the same dist path.
      const { cacophony, context } = await distMakeOffline({
        length: 1,
        sampleRate: sr,
        numberOfChannels: 2,
        quiet: true,
      });
      const src = await distDecode(context, TEST_OGG);
      const stretched = cacophony.timeStretchBuffer(src, 2);
      const ratio = stretched.length / src.length;

      // eslint-disable-next-line no-console
      console.log(`[stretch buffer] srcLen=${src.length} stretchedLen=${stretched.length} ratio=${ratio.toFixed(4)}`);

      expect(ratio).toBeCloseTo(2, 2);
    });

    it("group of two sounds sums to a peak ≥ a single source's peak", async () => {
      const base = { source: TEST_OGG, durationSec: 1, sampleRate: sr, numberOfChannels: 2 };
      const single = bufferStats(await renderToBuffer(base, distMakeOffline));
      const group = bufferStats(await renderToBuffer({ ...base, groupSources: [TEST_OGG] }, distMakeOffline));

      // eslint-disable-next-line no-console
      console.log(`[group] single peak=${single.peak.toFixed(4)} group(2x) peak=${group.peak.toFixed(4)}`);

      expect(group.peak).toBeGreaterThanOrEqual(single.peak);
      expect(group.nonSilentSamples).toBeGreaterThan(0);
    });

    it("REPL render replays a synth+fx command log into a non-silent buffer showing the fx delta", async () => {
      // The synth+fx replay case (plan R5): the clean log (no fx) vs the same log
      // with a distortion on the fx bus + route must differ.
      const cleanLog = [{ kind: "synth" as const, name: "s1", freq: 220, wave: "sawtooth" }];
      const fxLog = [
        { kind: "synth" as const, name: "s1", freq: 220, wave: "sawtooth" },
        { kind: "fx" as const, busName: "fx", effect: "distortion", params: "drive=40,shape=tanh" },
        { kind: "route" as const, name: "s1", busName: "fx" },
      ];
      const replayParams = { durationSec: 0.3, sampleRate: sr, numberOfChannels: 2, bitDepth: 16 as const };

      const clean = await replayToBuffer(cleanLog, replayParams, distMakeOffline);
      const withFx = await replayToBuffer(fxLog, replayParams, distMakeOffline);

      const cleanPeak = bufferStats(clean.buffer).peak;
      const fxStats = bufferStats(withFx.buffer);

      // eslint-disable-next-line no-console
      console.log(`[repl render] clean peak=${cleanPeak.toFixed(4)} withFx peak=${fxStats.peak.toFixed(4)}`);

      expect(fxStats.nonSilentSamples).toBeGreaterThan(0);
      expect(Math.abs(fxStats.peak - cleanPeak)).toBeGreaterThan(1e-3);
      expect(withFx.skipped).toHaveLength(0);
    });
  },
);

/**
 * Coarse magnitude-weighted spectral centroid (Hz) over channel 0 via the repo's
 * `fft.js` dependency. Used to prove the pitch-shift moves energy upward.
 */
function spectralCentroid(buffer: AudioBuffer, sampleRate: number): number {
  const d = new Float32Array(buffer.length);
  buffer.copyFromChannel(d, 0);

  // Power-of-two window from the middle of the signal (avoid edges).
  const N = 16384;
  const start = Math.max(0, Math.floor((d.length - N) / 2));
  const frame = new Float32Array(N);
  for (let i = 0; i < N && start + i < d.length; i++) {
    // Hann window.
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    frame[i] = d[start + i] * w;
  }

  const fft = new FFT(N);
  const out = fft.createComplexArray();
  const input = fft.toComplexArray(frame, fft.createComplexArray());
  fft.transform(out, input);

  let weighted = 0;
  let total = 0;
  for (let k = 0; k < N / 2; k++) {
    const re = out[2 * k];
    const im = out[2 * k + 1];
    const mag = Math.sqrt(re * re + im * im);
    const freq = (k * sampleRate) / N;
    weighted += freq * mag;
    total += mag;
  }
  return total > 0 ? weighted / total : 0;
}
