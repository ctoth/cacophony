import FFT from "fft.js";
import { beforeAll, describe, expect, it } from "vitest";

/*
 * Phaser DATA-PLANE proof (Smith STAN-M-21 / PASP §8.9).
 *
 * The effect-layer tests (src/phaser-effect.test.ts) prove the worklet is built
 * via `createPhaserNode` and spliced into a Bus with the right parameterData —
 * but they use a FAKE worklet node, so they cannot prove the *signal* is
 * actually phased. This file closes that gap: it shims the AudioWorklet globals,
 * imports the REAL worklet shell, drives deterministic input through it, and
 * asserts the physical effect (spectral notches that move with the LFO) with
 * non-vacuous guards, mirroring modulated-delay-acoustic.test.ts.
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

const { PhaserWorkletProcessor } = await import("./phaser");

type Params = Record<string, Float32Array>;

/** Build a k-rate parameter map from a partial override over the worklet defaults. */
function params(overrides: Record<string, number> = {}): Params {
  const base: Record<string, number> = {
    frequency: 500,
    rate: 0.5,
    depth: 1.5,
    stages: 4,
    feedback: 0,
    mix: 0.5,
    ...overrides,
  };
  const out: Params = {};
  for (const key of Object.keys(base)) out[key] = new Float32Array([base[key]]);
  return out;
}

/** Run a mono signal through the processor in 128-sample blocks; return the output. */
function runMono(signal: Float32Array, p: Params): Float32Array {
  const proc = new PhaserWorkletProcessor();
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

/** Transfer-function magnitude |H(f)| via the impulse response (FFT of impulse). */
function transferMagnitude(p: Params, N = 8192): Float64Array {
  const input = new Float32Array(N);
  input[0] = 1;
  const out = runMono(input, p);
  const fft = new FFT(N);
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, out as unknown as number[]);
  fft.completeSpectrum(spectrum);
  const mag = new Float64Array(N / 2 + 1);
  for (let bin = 0; bin <= N / 2; bin++) {
    const re = spectrum[bin * 2];
    const im = spectrum[bin * 2 + 1];
    mag[bin] = Math.sqrt(re * re + im * im);
  }
  return mag;
}

describe("phaser data-plane: the worklet actually carves moving notches", () => {
  beforeAll(() => {
    expect(typeof PhaserWorkletProcessor).toBe("function");
  });

  it("a static phaser carves a deep spectral notch (|H| dips well below the dry level)", () => {
    // rate=0 freezes the sweep; mix=1 deepest. The additive allpass-cascade sum
    // must drop |H| close to 0 somewhere (a real notch).
    const mag = transferMagnitude(params({ frequency: 1000, rate: 0, depth: 0, stages: 4, mix: 1 }));
    let energy = 0;
    for (const m of mag) energy += m * m;
    expect(energy).toBeGreaterThan(0); // non-vacuous

    let minMag = Number.POSITIVE_INFINITY;
    for (let bin = 5; bin < mag.length - 5; bin++) minMag = Math.min(minMag, mag[bin]);
    expect(minMag).toBeLessThan(0.1);
  });

  it("the additive sum gives |H(DC)| ~= 2 (NOT a wet/dry crossfade, which would be <= 1)", () => {
    const mag = transferMagnitude(params({ frequency: 1000, rate: 0, depth: 0, stages: 4, mix: 1 }));
    expect(mag[1]).toBeGreaterThan(1.5);
  });

  it("mix=0 is an exact passthrough (a pure tone is unchanged)", () => {
    const N = 4096;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * 100 * i) / N);
    const out = runMono(input, params({ mix: 0, rate: 2, depth: 2 }));
    for (let i = 0; i < N; i++) expect(out[i]).toBeCloseTo(input[i], 5);
  });

  it("the worklet seeds a quadrature stereo LFO: the two channels' spectra differ", () => {
    // The shell seeds channel ch with ch*pi/2, so at rate=0 channel 0's LFO is
    // frozen at sin(0)=0 (fb = frequency) while channel 1's is at sin(pi/2)=+1
    // (fb swept up by depth octaves). Feed the SAME impulse to both channels and
    // the resulting per-channel transfer magnitudes — hence the notch positions —
    // must differ, proving the quadrature seeding actually drives the sweep.
    const N = 8192;
    const proc = new PhaserWorkletProcessor();
    const in0 = new Float32Array(N);
    const in1 = new Float32Array(N);
    in0[0] = 1;
    in1[0] = 1;
    const out0 = new Float32Array(N);
    const out1 = new Float32Array(N);
    const p = params({ frequency: 1000, rate: 0, depth: 2, stages: 4, mix: 1 });
    const BLOCK = 128;
    for (let start = 0; start < N; start += BLOCK) {
      const len = Math.min(BLOCK, N - start);
      proc.process(
        [[in0.subarray(start, start + len) as Float32Array, in1.subarray(start, start + len) as Float32Array]],
        [[out0.subarray(start, start + len), out1.subarray(start, start + len)]],
        p,
      );
    }
    const mag = (sig: Float32Array): Float64Array => {
      const fft = new FFT(N);
      const spectrum = fft.createComplexArray();
      fft.realTransform(spectrum, sig as unknown as number[]);
      fft.completeSpectrum(spectrum);
      const m = new Float64Array(N / 2 + 1);
      for (let bin = 0; bin <= N / 2; bin++) m[bin] = Math.hypot(spectrum[bin * 2], spectrum[bin * 2 + 1]);
      return m;
    };
    const m0 = mag(out0);
    const m1 = mag(out1);
    let maxLogDiff = 0;
    for (let bin = 5; bin < N / 4; bin++) {
      maxLogDiff = Math.max(maxLogDiff, Math.abs(Math.log((m0[bin] + 1e-9) / (m1[bin] + 1e-9))));
    }
    expect(maxLogDiff).toBeGreaterThan(1); // notches landed in different places
  });

  it("feedback keeps the output finite and bounded", () => {
    const N = 8192;
    const input = new Float32Array(N);
    input[0] = 1;
    const out = runMono(input, params({ frequency: 800, rate: 2, depth: 1.5, feedback: 0.95, mix: 1 }));
    let max = 0;
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      max = Math.max(max, Math.abs(v));
    }
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(20);
  });
});
