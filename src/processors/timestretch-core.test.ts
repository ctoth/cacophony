import { describe, expect, it } from "vitest";
import { timeStretch, timeStretchChannels } from "./timestretch-core";

/*
 * Tests for the OFFLINE PGHI time-stretch core (Průša 2022, "Phase Vocoder
 * Done Right"). The phase is reconstructed from the analysis-phase gradients via
 * Phase Gradient Heap Integration with the paper's CENTERED frequency-direction
 * derivative (Eqs 16-18) and TRAPEZOIDAL frequency integration (Algorithm 1,
 * lines 17/22). The load-bearing properties this suite proves:
 *   1. SPECTRAL identity at factor=1 — output is the same tone at the same
 *      amplitude (PGHI reconstructs phase only up to a global shift, so the
 *      correct tight identity metric is spectral, not sample-exact waveform).
 *   2. CHIRP / TRANSIENT vertical phase coherence — a swept chirp and an impulse
 *      stay spectrally/temporally concentrated. These bounds are tight enough to
 *      FAIL on the previous forward-only one-sided frequency scheme (measured:
 *      that scheme produced larger spectral/temporal spread).
 *   3. Framing-geometry validation — invalid fftSize/analysisHop is rejected, so
 *      no fractional hop reads off-grid and injects NaN.
 */

const SR = 44100;

/** Pure cosine of `freqHz` over `length` samples at sample rate SR. */
function sinusoid(freqHz: number, length: number, sr = SR): Float32Array {
  const out = new Float32Array(length);
  const w = (2 * Math.PI * freqHz) / sr;
  for (let i = 0; i < length; i++) out[i] = Math.cos(w * i);
  return out;
}

/** Linear chirp sweeping f0 → f1 over the whole buffer (phase = integral of f). */
function linearChirp(f0: number, f1: number, length: number, sr = SR): Float32Array {
  const out = new Float32Array(length);
  const T = length / sr;
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const phase = 2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * T));
    out[i] = Math.cos(phase);
  }
  return out;
}

/** Single unit impulse at `pos`. */
function singleImpulse(pos: number, length: number): Float32Array {
  const out = new Float32Array(length);
  out[pos] = 1;
  return out;
}

/**
 * Naive single-bin DFT magnitude (independent of fft.js) over the central
 * `nFft` samples. Returns re/im for one bin `k` of an `nFft`-point DFT.
 */
function binPower(signal: Float32Array, center: number, k: number, nFft: number): number {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * k) / nFft;
  for (let i = 0; i < nFft; i++) {
    const idx = center - nFft / 2 + i;
    const x = idx >= 0 && idx < signal.length ? signal[idx] : 0;
    re += x * Math.cos(w * i);
    im -= x * Math.sin(w * i);
  }
  return re * re + im * im;
}

/** Dominant (max-power) bin of a real signal's DFT over its central window. */
function dominantBin(signal: Float32Array, nFft: number): number {
  const center = Math.floor(signal.length / 2);
  let best = -1;
  let bestMag = -1;
  for (let k = 1; k < nFft / 2; k++) {
    const p = binPower(signal, center, k, nFft);
    if (p > bestMag) {
      bestMag = p;
      best = k;
    }
  }
  return best;
}

/**
 * Dominant-bin index of a Hann-windowed frame centered at `center`. Used to
 * trace the instantaneous frequency of a chirp across the output.
 */
function dominantBinAt(signal: Float32Array, center: number, nFft: number): number {
  let best = -1;
  let bestMag = -1;
  for (let k = 1; k < nFft / 2; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / nFft;
    for (let i = 0; i < nFft; i++) {
      const idx = center - nFft / 2 + i;
      const x = idx >= 0 && idx < signal.length ? signal[idx] : 0;
      const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / nFft));
      re += x * win * Math.cos(w * i);
      im -= x * win * Math.sin(w * i);
    }
    const p = re * re + im * im;
    if (p > bestMag) {
      bestMag = p;
      best = k;
    }
  }
  return best;
}

/**
 * Average per-frame spectral spread (energy-weighted std-dev of bin index about
 * the per-frame peak bin), over Hann-windowed frames. A phase-coherent stretched
 * chirp keeps a single sharp instantaneous frequency per frame → low spread;
 * decoherence smears energy → high spread. This is the metric that distinguishes
 * the paper's centered/trapezoidal frequency integration from the old forward-
 * only scheme.
 */
function avgSpectralSpread(signal: Float32Array, nFft: number, hop: number): number {
  let total = 0;
  let count = 0;
  for (let center = nFft; center + nFft < signal.length; center += hop) {
    const re = new Float64Array(nFft / 2);
    const im = new Float64Array(nFft / 2);
    let peak = -1;
    let peakK = 0;
    for (let k = 1; k < nFft / 2; k++) {
      let sr = 0;
      let si = 0;
      const w = (2 * Math.PI * k) / nFft;
      for (let i = 0; i < nFft; i++) {
        const idx = center - nFft / 2 + i;
        const x = idx >= 0 && idx < signal.length ? signal[idx] : 0;
        const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / nFft));
        sr += x * win * Math.cos(w * i);
        si -= x * win * Math.sin(w * i);
      }
      re[k] = sr;
      im[k] = si;
      const p = sr * sr + si * si;
      if (p > peak) {
        peak = p;
        peakK = k;
      }
    }
    let sumP = 0;
    let sumKP = 0;
    for (let k = 1; k < nFft / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      sumP += p;
      sumKP += p * (k - peakK) * (k - peakK);
    }
    if (sumP > 1e-12) {
      total += Math.sqrt(sumKP / sumP);
      count++;
    }
  }
  return total / (count || 1);
}

/** Energy-weighted temporal spread (std-dev of sample index about the energy centroid). */
function temporalSpread(signal: Float32Array): number {
  let sumE = 0;
  let sumIE = 0;
  for (let i = 0; i < signal.length; i++) {
    const e = signal[i] * signal[i];
    sumE += e;
    sumIE += e * i;
  }
  if (sumE === 0) return 0;
  const centroid = sumIE / sumE;
  let sumVar = 0;
  for (let i = 0; i < signal.length; i++) {
    const e = signal[i] * signal[i];
    sumVar += e * (i - centroid) * (i - centroid);
  }
  return Math.sqrt(sumVar / sumE);
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

/** RMS over the central half (avoids windowed edges). */
function midRms(a: Float32Array): number {
  let sum = 0;
  const lo = Math.floor(a.length / 4);
  const hi = Math.floor((3 * a.length) / 4);
  for (let i = lo; i < hi; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / (hi - lo));
}

describe("timeStretch — offline PGHI time-stretch (Průša 2022)", () => {
  describe("unit: output length is exactly round(input.length · factor)", () => {
    const N = 16384;
    const input = sinusoid(440, N);
    for (const factor of [0.5, 1.0, 1.5, 2.0]) {
      it(`factor=${factor}`, () => {
        const out = timeStretch(input, factor);
        expect(out.length).toBe(Math.round(N * factor));
      });
    }
  });

  it("PITCH PRESERVED: a sinusoid keeps its dominant frequency after stretching", () => {
    const freq = 5512.5; // SR/8 — lands on a bin for a power-of-two DFT
    const N = 32768;
    const input = sinusoid(freq, N);
    const nFft = 4096;
    const inBin = dominantBin(input, nFft);
    for (const factor of [0.5, 1.5, 2.0]) {
      const out = timeStretch(input, factor);
      const outBin = dominantBin(out, nFft);
      expect(Math.abs(outBin - inBin)).toBeLessThanOrEqual(1);
    }
  });

  it("SPECTRAL IDENTITY at factor=1: same tone, same amplitude, high spectral purity", () => {
    // PGHI reconstructs phase only up to a global shift, so identity is asserted
    // in the spectral domain: the output is a near-pure sinusoid at the SAME
    // bin and amplitude as the input. These bounds are far tighter than the old
    // ±30% RMS + dominant-bin-only check — they require the output's energy to
    // be concentrated in the original tone bin (a broken phase integrator that
    // smears energy across neighbouring bins fails the purity bound).
    const N = 8192;
    const nFft = 4096;
    for (const freq of [440, 2000, 5512.5]) {
      const input = sinusoid(freq, N);
      const out = timeStretch(input, 1.0);
      expect(out.length).toBe(N);
      expect(allFinite(out)).toBe(true);

      const inBin = dominantBin(input, nFft);
      const outBin = dominantBin(out, nFft);
      expect(outBin).toBe(inBin); // exact same frequency bin

      // Spectral purity: peak-bin power / total power over the central frame.
      const center = Math.floor(out.length / 2);
      let total = 0;
      for (let k = 1; k < nFft / 2; k++) total += binPower(out, center, k, nFft);
      const peakFrac = binPower(out, center, outBin, nFft) / total;
      // A clean tone keeps almost all energy in its bin (+ leakage neighbours).
      expect(peakFrac).toBeGreaterThan(0.6);

      // Amplitude preserved (COLA gain ≈ 1) within a TIGHT ±12% band.
      const ratio = midRms(out) / midRms(input);
      expect(ratio).toBeGreaterThan(0.88);
      expect(ratio).toBeLessThan(1.12);
    }
  });

  it("CHIRP coherence: a stretched linear chirp keeps its monotonic sweep, no smearing", () => {
    // The frequency-direction phase handling (Průša 2022 p.2: Δf φ is non-zero
    // for a chirp) must keep the swept tone coherent rather than smeared. A chirp
    // stretched by 2 must (a) still sweep monotonically across the doubled
    // duration, (b) cover its frequency range, and (c) keep a bounded per-frame
    // spectral spread (< 11.0; the directional PGHI scheme measures ≈ 10.37). A
    // phase integrator that decoheres the chirp blows the spread up well past
    // this and/or breaks the monotonic sweep.
    const N = 8192;
    const input = linearChirp(400, 6000, N);
    const out = timeStretch(input, 2.0);
    expect(allFinite(out)).toBe(true);
    expect(out.length).toBe(Math.round(N * 2.0));

    const L = out.length;
    const bins = [0.2, 0.4, 0.6, 0.8].map((f) => dominantBinAt(out, Math.floor(L * f), 1024));
    // monotonically rising sweep (allow ±1 bin slop between consecutive points)
    for (let i = 1; i < bins.length; i++) {
      expect(bins[i]).toBeGreaterThanOrEqual(bins[i - 1] - 1);
    }
    // the sweep must actually cover a range (not collapse to a single freq)
    expect(bins[bins.length - 1]).toBeGreaterThan(bins[0] + 10);

    const spread = avgSpectralSpread(out, 1024, 256);
    expect(spread).toBeLessThan(11.0);
  });

  it("TRANSIENT coherence: a stretched single impulse stays a concentrated burst", () => {
    // A transient is a vertical spectral ridge; the magnitude-prioritized heap
    // integration spreads phase along it so the impulse stays a single localized
    // burst rather than dissolving across the whole output. Temporal spread of
    // the impulse stretched by 3 is bounded (< 1750 samples; measured ≈ 1672)
    // and it remains a real, full-amplitude burst (not cancelled by OLA).
    const N = 8192;
    const input = singleImpulse(4096, N);
    const out = timeStretch(input, 3.0);
    expect(allFinite(out)).toBe(true);
    expect(temporalSpread(out)).toBeLessThan(1750);
    expect(maxAbs(out)).toBeGreaterThan(0.3);
  });

  it("FRAMING VALIDATION: invalid fftSize/analysisHop is rejected (no NaN reaches the FFT)", () => {
    const input = sinusoid(440, 4096);
    // fftSize below the integer-hop floor (M/4 must be a positive integer ≥ 1).
    expect(() => timeStretch(input, 1.5, { fftSize: 2 })).toThrow();
    expect(() => timeStretch(input, 1.5, { fftSize: 8 })).toThrow();
    // non-power-of-two
    expect(() => timeStretch(input, 1.5, { fftSize: 1000 })).toThrow();
    // fractional / zero / negative / non-finite analysisHop
    expect(() => timeStretch(input, 1.5, { analysisHop: 10.5 })).toThrow();
    expect(() => timeStretch(input, 1.5, { analysisHop: 0 })).toThrow();
    expect(() => timeStretch(input, 1.5, { analysisHop: -4 })).toThrow();
    expect(() => timeStretch(input, 1.5, { analysisHop: Number.NaN })).toThrow();
    expect(() => timeStretch(input, 1.5, { analysisHop: Number.POSITIVE_INFINITY })).toThrow();
    // hop larger than the window (leaves uncovered gaps)
    expect(() => timeStretch(input, 1.5, { fftSize: 256, analysisHop: 300 })).toThrow();

    // A valid explicit integer hop must NOT throw and must produce finite output.
    const ok = timeStretch(input, 1.5, { fftSize: 1024, analysisHop: 256 });
    expect(allFinite(ok)).toBe(true);
  });

  it("rejects non-positive factor", () => {
    const input = sinusoid(440, 4096);
    expect(() => timeStretch(input, 0)).toThrow();
    expect(() => timeStretch(input, -1)).toThrow();
  });

  it("no NaN/Inf for a tonal input across factors", () => {
    const input = sinusoid(1000, 16384);
    for (const factor of [0.5, 1.0, 1.5, 2.0, 3.0]) {
      expect(allFinite(timeStretch(input, factor))).toBe(true);
    }
  });

  it("no NaN/Inf for a noisy input, and output stays bounded", () => {
    const N = 16384;
    const noise = new Float32Array(N);
    let seed = 12345;
    for (let i = 0; i < N; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = (seed / 0x3fffffff - 1) * 0.5;
    }
    for (const factor of [0.5, 1.0, 1.5, 2.0]) {
      const out = timeStretch(noise, factor);
      expect(allFinite(out)).toBe(true);
      expect(maxAbs(out)).toBeLessThan(10 * maxAbs(noise) + 1e-3);
    }
  });

  it("silence in → silence out (no NaN from the abstol/zero-magnitude path)", () => {
    const input = new Float32Array(8192);
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

  describe("timeStretchChannels", () => {
    it("stretches each channel independently, same output length", () => {
      const l = sinusoid(440, 8192);
      const r = sinusoid(660, 8192);
      const [outL, outR] = timeStretchChannels([l, r], 2.0);
      expect(outL.length).toBe(outR.length);
      expect(outL.length).toBe(Math.round(8192 * 2.0));
      expect(allFinite(outL)).toBe(true);
      expect(allFinite(outR)).toBe(true);
      expect(dominantBin(outL, 4096)).toBe(dominantBin(l, 4096));
      expect(dominantBin(outR, 4096)).toBe(dominantBin(r, 4096));
    });
  });
});
