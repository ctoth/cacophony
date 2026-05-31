import { describe, expect, it } from "vitest";
import { timeStretch, timeStretchChannels } from "./timestretch-core";

/*
 * Tests for the OFFLINE PGHI time-stretch core (Průša 2022, "Phase Vocoder
 * Done Right"). The load-bearing correctness proof is `pitch preserved`: a
 * pure sinusoid stretched by factor ≠ 1 must remain a sinusoid at the SAME
 * frequency (tempo changed, pitch not). Everything else (length, identity at
 * factor=1, finiteness, monotonicity) gates around that.
 */

const SR = 44100;

/** Generate a pure cosine of `freqHz` over `length` samples at sample rate SR. */
function sinusoid(freqHz: number, length: number, sr = SR): Float32Array {
  const out = new Float32Array(length);
  const w = (2 * Math.PI * freqHz) / sr;
  for (let i = 0; i < length; i++) out[i] = Math.cos(w * i);
  return out;
}

/**
 * Index of the dominant magnitude bin of a real signal's DFT, computed
 * independently of fft.js with a naive Goertzel-free DFT over a candidate
 * range. We restrict to bins below Nyquist and skip DC to find the tonal peak.
 * Returns the bin index in an `nFft`-point DFT.
 */
function dominantBin(signal: Float32Array, nFft: number): number {
  // Use the central `nFft` samples (avoid fade-in/out edge frames).
  const start = Math.max(0, Math.floor((signal.length - nFft) / 2));
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  for (let k = 1; k < nFft / 2; k++) {
    let sr = 0;
    let si = 0;
    const w = (2 * Math.PI * k) / nFft;
    for (let i = 0; i < nFft; i++) {
      const x = start + i < signal.length ? signal[start + i] : 0;
      sr += x * Math.cos(w * i);
      si -= x * Math.sin(w * i);
    }
    re[k] = sr;
    im[k] = si;
  }
  let best = -1;
  let bestMag = -1;
  for (let k = 1; k < nFft / 2; k++) {
    const mag = re[k] * re[k] + im[k] * im[k];
    if (mag > bestMag) {
      bestMag = mag;
      best = k;
    }
  }
  return best;
}

function allFinite(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) return false;
  }
  return true;
}

function maxAbs(a: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.abs(a[i]);
    if (v > m) m = v;
  }
  return m;
}

describe("timeStretch — offline PGHI time-stretch (Průša 2022)", () => {
  describe("unit: output length ≈ round(input.length · factor)", () => {
    const N = 16384;
    const input = sinusoid(440, N);
    for (const factor of [0.5, 1.0, 1.5, 2.0]) {
      it(`factor=${factor}`, () => {
        const out = timeStretch(input, factor);
        const expected = Math.round(N * factor);
        // exact: the core returns precisely round(N·factor) samples.
        expect(out.length).toBe(expected);
      });
    }
  });

  it("PITCH PRESERVED (load-bearing): a sinusoid keeps its frequency after stretching", () => {
    // 11025 Hz = SR/4 → bin SR/4 maps to nFft/4 in an nFft-point DFT, well
    // clear of DC and Nyquist. A long input so the analysis is stable.
    const freq = 5512.5; // SR/8 — lands exactly on a bin for nFft = power of 2
    const N = 32768;
    const input = sinusoid(freq, N);
    const nFft = 4096;

    const inBin = dominantBin(input, nFft);

    for (const factor of [0.5, 1.5, 2.0]) {
      const out = timeStretch(input, factor);
      const outBin = dominantBin(out, nFft);
      // The dominant bin must be unchanged (pitch is independent of tempo).
      // Allow ±1 bin for the centered-difference / windowing slop.
      expect(Math.abs(outBin - inBin)).toBeLessThanOrEqual(1);
    }
  });

  it("identity at factor=1: reconstructs the input closely (COLA)", () => {
    const N = 8192;
    const input = sinusoid(440, N);
    const out = timeStretch(input, 1.0);
    expect(out.length).toBe(N);

    // Compare a central region (avoid the windowed edges) — the reconstruction
    // should track the input with bounded error. PGHI re-derives phase, so the
    // absolute waveform can differ by a global phase; instead assert the energy
    // envelope and that the dominant bin is identical.
    const inBin = dominantBin(input, 4096);
    const outBin = dominantBin(out, 4096);
    expect(outBin).toBe(inBin);

    // RMS amplitude preserved within a tolerance (COLA gain ≈ 1).
    const mid = (a: Float32Array) => {
      let sum = 0;
      const lo = Math.floor(a.length / 4);
      const hi = Math.floor((3 * a.length) / 4);
      for (let i = lo; i < hi; i++) sum += a[i] * a[i];
      return Math.sqrt(sum / (hi - lo));
    };
    const rIn = mid(input);
    const rOut = mid(out);
    expect(rOut).toBeGreaterThan(rIn * 0.7);
    expect(rOut).toBeLessThan(rIn * 1.3);
  });

  it("no NaN/Inf for a tonal input across factors", () => {
    const input = sinusoid(1000, 16384);
    for (const factor of [0.5, 1.0, 1.5, 2.0, 3.0]) {
      const out = timeStretch(input, factor);
      expect(allFinite(out)).toBe(true);
    }
  });

  it("no NaN/Inf for a noisy input, and output stays bounded", () => {
    const N = 16384;
    const noise = new Float32Array(N);
    // deterministic pseudo-noise
    let seed = 12345;
    for (let i = 0; i < N; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (seed / 0x3fffffff - 1) * 0.5;
    }
    for (const factor of [0.5, 1.0, 1.5, 2.0]) {
      const out = timeStretch(noise, factor);
      expect(allFinite(out)).toBe(true);
      // bounded: time-stretch must not blow up amplitude relative to input.
      expect(maxAbs(out)).toBeLessThan(10 * maxAbs(noise) + 1e-3);
    }
  });

  it("silence in → silence out (no NaN from the abstol/zero-magnitude path)", () => {
    const input = new Float32Array(8192); // all zeros
    const out = timeStretch(input, 2.0);
    expect(allFinite(out)).toBe(true);
    expect(maxAbs(out)).toBeLessThan(1e-6);
  });

  it("property: output length is monotonic non-decreasing in factor", () => {
    const input = sinusoid(440, 16384);
    const factors = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
    let prevLen = -1;
    for (const f of factors) {
      const out = timeStretch(input, f);
      expect(out.length).toBeGreaterThanOrEqual(prevLen);
      prevLen = out.length;
      // finite + bounded across the whole sweep
      expect(allFinite(out)).toBe(true);
      expect(maxAbs(out)).toBeLessThan(5);
    }
  });

  it("deterministic: same input+factor+seed produces identical output", () => {
    const input = sinusoid(880, 8192);
    const a = timeStretch(input, 1.5, { randomSeed: 42 });
    const b = timeStretch(input, 1.5, { randomSeed: 42 });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
  });

  it("rejects non-positive factor and non-power-of-two fftSize", () => {
    const input = sinusoid(440, 4096);
    expect(() => timeStretch(input, 0)).toThrow();
    expect(() => timeStretch(input, -1)).toThrow();
    expect(() => timeStretch(input, 1.5, { fftSize: 1000 })).toThrow();
  });

  describe("timeStretchChannels", () => {
    it("stretches each channel independently, same output length", () => {
      const l = sinusoid(440, 8192);
      const r = sinusoid(660, 8192);
      const [outL, outR] = timeStretchChannels([l, r], 2.0);
      expect(outL.length).toBe(outR.length);
      expect(outL.length).toBe(Math.round(8192 * 2.0));
      expect(allFinite(outL)).toBe(true);
      expect(allFinite(outR)).toBe(true);
      // each channel keeps its own pitch
      expect(dominantBin(outL, 4096)).toBe(dominantBin(l, 4096));
      expect(dominantBin(outR, 4096)).toBe(dominantBin(r, 4096));
    });
  });
});
