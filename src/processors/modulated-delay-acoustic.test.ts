import FFT from "fft.js";
import { beforeAll, describe, expect, it } from "vitest";

import { DATTORRO_INV_SQRT2 } from "./modulated-delay-core";

/*
 * Modulated-delay DATA-PLANE proof (Dattorro 1997 Fig. 36, Laakso 1996).
 *
 * The effect-layer tests (src/modulated-delay-effect.test.ts) prove the worklet
 * is built via `createModulatedDelayNode` and spliced into a Bus with the right
 * Table 6 parameterData — but they use a FAKE worklet node, so they cannot prove
 * the *signal* is actually delayed/flanged/vibrato'd. This file closes that gap:
 * it shims the AudioWorklet globals, imports the REAL worklet shell, drives
 * deterministic input through it, and asserts the physical effect happened with
 * non-vacuous guards (energy > 0; not stuck at the wrong bin), mirroring
 * phase-vocoder-acoustic.test.ts.
 */

// --- AudioWorklet global shim (must run before importing the shell) ----------
class FakeAudioWorkletProcessor {
  port = { postMessage() {}, addEventListener() {} } as unknown as MessagePort;
  constructor(_options?: unknown) {}
}
const SAMPLE_RATE = 48000;
const g = globalThis as unknown as {
  AudioWorkletProcessor: unknown;
  registerProcessor: unknown;
  sampleRate: number;
};
g.AudioWorkletProcessor = FakeAudioWorkletProcessor;
g.registerProcessor = () => {};
g.sampleRate = SAMPLE_RATE;

const { ModulatedDelayWorkletProcessor } = await import("./modulated-delay");

type Params = Record<string, Float32Array>;

/** Build a k-rate parameter map from a partial override over the worklet defaults. */
function params(overrides: Record<string, number> = {}): Params {
  const base: Record<string, number> = {
    delayTime: 5,
    depth: 0,
    rate: 0.5,
    feedback: 0,
    blend: 1,
    feedforward: DATTORRO_INV_SQRT2,
    interpolation: 0,
    ...overrides,
  };
  const out: Params = {};
  for (const key of Object.keys(base)) out[key] = new Float32Array([base[key]]);
  return out;
}

/** Run a mono signal through the processor in 128-sample blocks; return the concatenated output. */
function runMono(signal: Float32Array, p: Params): Float32Array {
  const proc = new ModulatedDelayWorkletProcessor();
  const out = new Float32Array(signal.length);
  const BLOCK = 128;
  for (let start = 0; start < signal.length; start += BLOCK) {
    const len = Math.min(BLOCK, signal.length - start);
    const inBlock = signal.subarray(start, start + len);
    const outBlock = new Float32Array(len);
    proc.process([[inBlock as Float32Array]], [[outBlock]], p);
    out.set(outBlock, start);
  }
  return out;
}

/** Index of the largest-magnitude sample. */
function argmaxAbs(signal: Float32Array, from = 0): number {
  let best = from;
  let bestVal = -1;
  for (let i = from; i < signal.length; i++) {
    const v = Math.abs(signal[i]);
    if (v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  return best;
}

/** Magnitude at FFT bin `bin` of a real signal of length N (power of two). */
function magAtBin(signal: Float32Array, bin: number): number {
  const N = signal.length;
  const fft = new FFT(N);
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, signal as unknown as number[]);
  fft.completeSpectrum(spectrum);
  const re = spectrum[bin * 2];
  const im = spectrum[bin * 2 + 1];
  return Math.sqrt(re * re + im * im);
}

/** Dominant magnitude-spectrum bin (ignoring DC). */
function dominantBin(signal: Float32Array): number {
  const N = signal.length;
  const fft = new FFT(N);
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, signal as unknown as number[]);
  fft.completeSpectrum(spectrum);
  let bestBin = 1;
  let bestMag = -1;
  for (let bin = 1; bin <= N / 2; bin++) {
    const re = spectrum[bin * 2];
    const im = spectrum[bin * 2 + 1];
    const mag = re * re + im * im;
    if (mag > bestMag) {
      bestMag = mag;
      bestBin = bin;
    }
  }
  return bestBin;
}

/** Pure sine of `bin` cycles across N samples. */
function sineAtBin(bin: number, N: number): Float32Array {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.sin((2 * Math.PI * bin * i) / N);
  return out;
}

describe("modulated-delay data-plane: the worklet actually delays/flanges/vibratos", () => {
  beforeAll(() => {
    expect(typeof ModulatedDelayWorkletProcessor).toBe("function");
  });

  it("an impulse reappears at the delay offset (cubic, depth 0)", () => {
    const delaySamples = 240; // 5 ms at 48 kHz
    const delayMs = (delaySamples / SAMPLE_RATE) * 1000;
    const input = new Float32Array(2048);
    input[0] = 1;
    // blend=0 isolates the wet tap so the echo is the only nonzero region.
    const out = runMono(input, params({ delayTime: delayMs, blend: 0, feedforward: 1 }));

    const energy = out.reduce((s, v) => s + v * v, 0);
    expect(energy).toBeGreaterThan(0); // non-vacuous

    const peak = argmaxAbs(out, 1); // ignore any tiny t=0 leakage
    expect(peak).toBeGreaterThanOrEqual(delaySamples - 2);
    expect(peak).toBeLessThanOrEqual(delaySamples + 2);
    // Guard against a vacuous pass: the echo did NOT stay at t=0.
    expect(peak).not.toBe(0);
  });

  it("a feedback echo train decays (Dattorro |feedback| < 1)", () => {
    const delaySamples = 256;
    const delayMs = (delaySamples / SAMPLE_RATE) * 1000;
    const input = new Float32Array(4096);
    input[0] = 1;
    const out = runMono(input, params({ delayTime: delayMs, blend: 0, feedforward: 1, feedback: 0.6 }));

    const echo1 = Math.abs(out[delaySamples]);
    const echo2 = Math.abs(out[delaySamples * 2]);
    const echo3 = Math.abs(out[delaySamples * 3]);
    expect(echo1).toBeGreaterThan(0); // non-vacuous
    expect(echo2).toBeLessThan(echo1);
    expect(echo3).toBeLessThan(echo2);
  });

  it("a sine through the flanger preset shows a comb notch (feedforward path cancels)", () => {
    const N = 4096;
    // A flanger sums dry + a delayed copy: H = blend + ff*z^-D has magnitude
    // troughs (comb notches) where the delayed copy is out of phase with dry.
    // With negative feedforward the notch sits where the round trip is in-phase.
    const delaySamples = 24; // first notch family around fs/(2*D)
    const delayMs = (delaySamples / SAMPLE_RATE) * 1000;

    // Pick a bin near a comb NOTCH and a bin near a comb PEAK for the static
    // (depth 0) flanger comb: notch at f where 2*pi*f*D/fs = pi (k odd) for the
    // blend=ff, ff>0 sum -> destructive at f = fs/(2D). bin = f*N/fs.
    const notchFreq = SAMPLE_RATE / (2 * delaySamples); // first destructive freq
    const notchBin = Math.round((notchFreq * N) / SAMPLE_RATE);
    const peakFreq = SAMPLE_RATE / delaySamples; // first constructive freq
    const peakBin = Math.round((peakFreq * N) / SAMPLE_RATE);

    // Static comb (depth 0) so the notch is well-defined; blend=ff=0.7071, no fb.
    const flangerStatic = params({
      delayTime: delayMs,
      depth: 0,
      blend: DATTORRO_INV_SQRT2,
      feedforward: DATTORRO_INV_SQRT2,
      feedback: 0,
    });

    const atNotch = runMono(sineAtBin(notchBin, N), flangerStatic);
    const atPeak = runMono(sineAtBin(peakBin, N), flangerStatic);

    // Steady-state gain at the notch frequency is much lower than at the peak.
    const notchGain = magAtBin(atNotch, notchBin);
    const peakGain = magAtBin(atPeak, peakBin);
    expect(peakGain).toBeGreaterThan(0); // non-vacuous
    expect(notchGain).toBeLessThan(peakGain * 0.5); // a real comb notch
  });

  it("vibrato periodically shifts a sine's spectral peak (pitch modulation)", () => {
    const N = 8192;
    const inputBin = 200;
    // Vibrato: 100% wet, deep + fast modulation so the instantaneous pitch sweeps
    // audibly. Analyze two half-cycle windows of the LFO; the spectral peak moves.
    const vib = params({
      delayTime: 2,
      depth: 4,
      rate: 8,
      blend: 0,
      feedforward: 1,
      feedback: 0,
    });
    const out = runMono(sineAtBin(inputBin, N), vib);

    const energy = out.reduce((s, v) => s + v * v, 0);
    expect(energy).toBeGreaterThan(0); // non-vacuous

    // Window the output where the LFO derivative is large (rising vs falling
    // delay) — the Doppler-like pitch shift moves the dominant bin off inputBin.
    const lfoPeriod = SAMPLE_RATE / 8; // samples per LFO cycle
    const win = Math.min(2048, Math.floor(lfoPeriod / 2));
    const risingStart = Math.floor(lfoPeriod * 0.5); // delay falling -> pitch up
    const fallingStart = Math.floor(lfoPeriod * 1.0); // delay rising  -> pitch down

    const rising = out.subarray(risingStart, risingStart + win);
    const falling = out.subarray(fallingStart, fallingStart + win);
    const binRising = dominantBin(Float32Array.from(rising));
    const binFalling = dominantBin(Float32Array.from(falling));

    const inputWinBin = Math.round((inputBin * win) / N);
    // The two windows do not both sit exactly on the unshifted bin — pitch moved.
    expect(binRising !== inputWinBin || binFalling !== inputWinBin).toBe(true);
    // And the two windows differ from each other (opposite pitch shift directions).
    expect(binRising).not.toBe(binFalling);
  });
});
