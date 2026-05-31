import { describe, expect, it } from "vitest";

import {
  TRUE_PEAK_OVERSAMPLE,
  TRUE_PEAK_POLYPHASE_FIR_48K,
  TruePeakDetector,
  truePeakDb,
  truePeakDbForChannel,
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
