import FFT from "fft.js";
import { beforeAll, describe, expect, it } from "vitest";

/*
 * Tremolo DATA-PLANE proof (AM theory; Dattorro 1997 p.776 quadrature LFO).
 *
 * The effect-layer tests (src/tremolo-effect.test.ts) prove the worklet is built
 * via `createTremoloNode` and spliced into a Bus with the right parameterData —
 * but they use a FAKE worklet node, so they cannot prove the *signal* is actually
 * amplitude-modulated. This file closes that gap: it shims the AudioWorklet
 * globals, imports the REAL worklet shell, drives a deterministic carrier through
 * it, and asserts the AM sidebands appear with non-vacuous guards, mirroring
 * phaser-acoustic.test.ts.
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

const { TremoloWorkletProcessor } = await import("./tremolo");

type Params = Record<string, Float32Array>;

/** Build a k-rate parameter map from a partial override over the worklet defaults. */
function params(overrides: Record<string, number> = {}): Params {
  const base: Record<string, number> = {
    rate: 5,
    depth: 0.5,
    shape: 0,
    stereoPhase: 0,
    ...overrides,
  };
  const out: Params = {};
  for (const key of Object.keys(base)) out[key] = new Float32Array([base[key]]);
  return out;
}

/** Run a mono signal through the processor in 128-sample blocks; return the output. */
function runMono(signal: Float32Array, p: Params): Float32Array {
  const proc = new TremoloWorkletProcessor();
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

/** Magnitude at FFT bin `bin` of a real signal of length N. */
function magAtBin(signal: Float32Array, bin: number): number {
  const N = signal.length;
  const fft = new FFT(N);
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, signal as unknown as number[]);
  fft.completeSpectrum(spectrum);
  return Math.hypot(spectrum[bin * 2], spectrum[bin * 2 + 1]);
}

describe("tremolo data-plane: the worklet actually amplitude-modulates", () => {
  beforeAll(() => {
    expect(typeof TremoloWorkletProcessor).toBe("function");
  });

  it("depth = 0 is an exact passthrough (a pure tone is unchanged)", () => {
    const N = 4096;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * 100 * i) / N);
    const out = runMono(input, params({ depth: 0, rate: 5 }));
    for (let i = 0; i < N; i++) expect(out[i]).toBeCloseTo(input[i], 5);
  });

  it("a sine carrier grows AM sidebands at f_c +/- rate (absent in the dry signal)", () => {
    const N = 8192;
    const carrierBin = 200;
    const sidebandBins = 12; // rate chosen so sidebands land on integer bins
    const rateHz = (sidebandBins * SAMPLE_RATE) / N;

    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * carrierBin * i) / N);
    const out = runMono(input, params({ depth: 1, rate: rateHz, shape: 0 }));

    const carrier = magAtBin(out, carrierBin);
    const wetLower = magAtBin(out, carrierBin - sidebandBins);
    const wetUpper = magAtBin(out, carrierBin + sidebandBins);
    const dryLower = magAtBin(input, carrierBin - sidebandBins);

    expect(carrier).toBeGreaterThan(0); // non-vacuous: carrier survives
    expect(dryLower).toBeLessThan(carrier * 1e-3); // dry has no sideband energy
    expect(wetLower).toBeGreaterThan(carrier * 0.05); // wet grew real sidebands
    expect(wetUpper).toBeGreaterThan(carrier * 0.05);
  });

  it("the per-sample gain never goes negative (true tremolo, not ring-mod)", () => {
    // Drive DC = 1 so the output IS the gain envelope; assert g >= 0 throughout.
    const N = SAMPLE_RATE;
    const dc = new Float32Array(N).fill(1);
    const out = runMono(dc, params({ depth: 1, rate: 7, shape: 0 }));
    let min = Number.POSITIVE_INFINITY;
    for (const v of out) min = Math.min(min, v);
    expect(min).toBeGreaterThanOrEqual(0);
  });

  it("stereoPhase = 180 pans hard: the two channels' gain envelopes are anti-phase", () => {
    const N = SAMPLE_RATE;
    const proc = new TremoloWorkletProcessor();
    const dc0 = new Float32Array(N).fill(1);
    const dc1 = new Float32Array(N).fill(1);
    const out0 = new Float32Array(N);
    const out1 = new Float32Array(N);
    const p = params({ depth: 1, rate: 4, stereoPhase: 180 });
    const BLOCK = 128;
    for (let start = 0; start < N; start += BLOCK) {
      const len = Math.min(BLOCK, N - start);
      proc.process(
        [[dc0.subarray(start, start + len) as Float32Array, dc1.subarray(start, start + len) as Float32Array]],
        [[out0.subarray(start, start + len), out1.subarray(start, start + len)]],
        p,
      );
    }
    // Correlate the two gain envelopes: anti-phase => strongly negative.
    let m0 = 0;
    let m1 = 0;
    for (let i = 0; i < N; i++) {
      m0 += out0[i];
      m1 += out1[i];
    }
    m0 /= N;
    m1 /= N;
    let cov = 0;
    let v0 = 0;
    let v1 = 0;
    for (let i = 0; i < N; i++) {
      const d0 = out0[i] - m0;
      const d1 = out1[i] - m1;
      cov += d0 * d1;
      v0 += d0 * d0;
      v1 += d1 * d1;
    }
    expect(cov / Math.sqrt(v0 * v1)).toBeLessThan(-0.9);
  });
});
