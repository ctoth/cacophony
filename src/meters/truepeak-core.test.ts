import { describe, expect, it } from "vitest";

import {
  TRUE_PEAK_MIN_OVERSAMPLED_RATE,
  TRUE_PEAK_OVERSAMPLE,
  TRUE_PEAK_POLYPHASE_FIR_48K,
  TruePeakDetector,
  truePeakDb,
  truePeakDbForChannel,
  truePeakOversampleFactor,
} from "./truepeak-core";

const SR = 48_000;

function sine(frequencyHz: number, amp: number, seconds: number, phase = 0): Float32Array {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * frequencyHz * i) / SR + phase);
  }
  return out;
}

describe("truepeak-core — ITU-R BS.1770-5 Annex 2", () => {
  it("exposes the verbatim 48-tap, 4-phase polyphase FIR", () => {
    expect(TRUE_PEAK_POLYPHASE_FIR_48K.length).toBe(4);
    for (const phase of TRUE_PEAK_POLYPHASE_FIR_48K) {
      expect(phase.length).toBe(12);
    }
    expect(TRUE_PEAK_OVERSAMPLE).toBe(4);
    // The big centre taps of the verbatim coefficient set (p.18-19).
    expect(TRUE_PEAK_POLYPHASE_FIR_48K[0][6]).toBe(0.97216796875);
    expect(TRUE_PEAK_POLYPHASE_FIR_48K[3][5]).toBe(0.97216796875);
    // Phase 3 is phase 0 reversed (linear-phase polyphase symmetry).
    const phase0 = TRUE_PEAK_POLYPHASE_FIR_48K[0];
    const phase3 = TRUE_PEAK_POLYPHASE_FIR_48K[3];
    for (let i = 0; i < phase0.length; i++) {
      expect(phase3[i]).toBe(phase0[phase0.length - 1 - i]);
    }
  });

  it("an inter-sample-peak signal reads a dBTP ABOVE its sample peak", () => {
    // A worst-case inter-sample-peak signal: a high-frequency tone whose true
    // peak falls between samples. Sample peak < 0 dBFS, true peak ~0 dBTP.
    // f close to Nyquist with a phase that lands peaks between samples.
    const freq = SR / 4 - 50; // near Nyquist/2 region with strong inter-sample lobes
    const samples = sine(freq, 1.0, 0.5, Math.PI / 4);
    let samplePeak = 0;
    for (let i = 0; i < samples.length; i++) {
      samplePeak = Math.max(samplePeak, Math.abs(samples[i]));
    }
    const samplePeakDb = 20 * Math.log10(samplePeak);
    const tp = truePeakDbForChannel(samples);
    expect(Number.isNaN(tp)).toBe(false);
    expect(tp).toBeGreaterThan(samplePeakDb);
  });

  it("a classic inter-sample overload: 0 dBFS Nyquist/2 quarter-phase tone exceeds 0 dBTP", () => {
    // ±1 alternating-ish pattern: a 12 kHz (=SR/4) full-scale tone sampled at a
    // 45° phase has sample values ~0.707 but inter-sample peaks reach ~1.0,
    // and the band-limited reconstruction can overshoot above 0 dBTP.
    const samples = sine(SR / 4, 1.0, 0.5, Math.PI / 4);
    const tp = truePeakDbForChannel(samples);
    expect(Number.isNaN(tp)).toBe(false);
    expect(tp).toBeGreaterThan(0); // inter-sample overload above full scale
  });

  it("a slow full-scale tone reads close to 0 dBTP (well-sampled, no overshoot)", () => {
    const samples = sine(1000, 1.0, 0.2);
    const tp = truePeakDbForChannel(samples);
    expect(tp).toBeGreaterThan(-0.5);
    expect(tp).toBeLessThan(0.5);
  });

  it("scaling the input by -6 dB drops the dBTP by ~6 dB", () => {
    const full = sine(SR / 4 - 50, 1.0, 0.3, Math.PI / 4);
    const half = sine(SR / 4 - 50, 0.5, 0.3, Math.PI / 4);
    const tpFull = truePeakDbForChannel(full);
    const tpHalf = truePeakDbForChannel(half);
    expect(tpFull - tpHalf).toBeCloseTo(20 * Math.log10(2), 2);
  });

  it("silence reads -Infinity dBTP, with no NaN", () => {
    const silent = new Float32Array(SR);
    const tp = truePeakDbForChannel(silent);
    expect(tp).toBe(-Infinity);
  });

  it("multi-channel truePeakDb returns the loudest channel's true peak", () => {
    const quiet = sine(1000, 0.25, 0.2);
    const loud = sine(1000, 1.0, 0.2);
    const tp = truePeakDb([quiet, loud]);
    expect(tp).toBeCloseTo(truePeakDbForChannel(loud), 6);
  });

  describe("sample-rate-aware oversampling (BS.1770-5 Annex 2 — oversampled rate ≥192 kHz)", () => {
    it("chooses an oversample factor whose oversampled rate reaches ≥192 kHz", () => {
      // 48 kHz: 4× = 192 kHz (exactly the requirement).
      expect(truePeakOversampleFactor(48_000)).toBe(4);
      expect(truePeakOversampleFactor(48_000) * 48_000).toBeGreaterThanOrEqual(TRUE_PEAK_MIN_OVERSAMPLED_RATE);
      // 44.1 kHz: hard-coded 4× would give only 176.4 kHz — BELOW 192 kHz; the
      // factor must rise to 5× (220.5 kHz). This is the bug the old hard-4× had.
      expect(44_100 * 4).toBeLessThan(TRUE_PEAK_MIN_OVERSAMPLED_RATE); // documents the bug
      expect(truePeakOversampleFactor(44_100)).toBeGreaterThanOrEqual(5);
      expect(truePeakOversampleFactor(44_100) * 44_100).toBeGreaterThanOrEqual(TRUE_PEAK_MIN_OVERSAMPLED_RATE);
      // Never below 4 (the verbatim FIR's design ratio), even at high rates.
      expect(truePeakOversampleFactor(96_000)).toBeGreaterThanOrEqual(4);
      expect(truePeakOversampleFactor(192_000)).toBeGreaterThanOrEqual(4);
    });

    it("a 44.1 kHz detector oversamples to ≥192 kHz (FAILS on the hard-coded-4× version)", () => {
      const SR_44 = 44_100;
      const detector = new TruePeakDetector(SR_44);
      // The bug: hard-coded 4× → 176.4 kHz < 192 kHz. The fixed detector must
      // pick ≥5×, so its effective oversampled rate clears the requirement.
      expect(detector.oversample).toBeGreaterThanOrEqual(5);
      expect(detector.oversample * SR_44).toBeGreaterThanOrEqual(TRUE_PEAK_MIN_OVERSAMPLED_RATE);
      expect(detector.fir.length).toBe(detector.oversample);
    });

    it("a 48 kHz detector keeps the verbatim 4-phase FIR (no regression)", () => {
      const detector = new TruePeakDetector(48_000);
      expect(detector.oversample).toBe(4);
      expect(detector.fir).toBe(TRUE_PEAK_POLYPHASE_FIR_48K);
    });

    it("the higher-rate detector still measures sane levels (−6 dB ⇒ ~−6 dBTP at 44.1 kHz)", () => {
      const SR_44 = 44_100;
      const n = Math.round(0.3 * SR_44);
      const make = (amp: number): Float32Array => {
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          out[i] = amp * Math.sin((2 * Math.PI * (SR_44 / 4 - 50) * i) / SR_44 + Math.PI / 4);
        }
        return out;
      };
      const tpFull = truePeakDbForChannel(make(1.0), SR_44);
      const tpHalf = truePeakDbForChannel(make(0.5), SR_44);
      expect(Number.isFinite(tpFull)).toBe(true);
      expect(tpFull - tpHalf).toBeCloseTo(20 * Math.log10(2), 1);
    });
  });

  it("a streaming detector joins blocks seamlessly (block split == whole signal)", () => {
    const samples = sine(SR / 4 - 50, 1.0, 0.3, Math.PI / 4);
    const whole = truePeakDbForChannel(samples);

    const streamed = new TruePeakDetector();
    const blockSize = 128;
    for (let i = 0; i < samples.length; i += blockSize) {
      streamed.process(samples.subarray(i, Math.min(i + blockSize, samples.length)));
    }
    expect(streamed.truePeakDb()).toBeCloseTo(whole, 6);
  });
});
