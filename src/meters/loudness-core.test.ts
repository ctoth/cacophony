import { describe, expect, it } from "vitest";

import {
  CHANNEL_WEIGHTS,
  integratedLoudness,
  integratedUngatedLoudness,
  K_WEIGHTING_STAGE1_48K,
  K_WEIGHTING_STAGE2_48K,
  KWeightingFilter,
  kWeightingCoefficients,
  LOUDNESS_OFFSET,
  type LoudnessChannel,
  type LoudnessChannelInput,
  loudnessRange,
  powerSumToLoudness,
  REFERENCE_SAMPLE_RATE,
} from "./loudness-core";

const SR = REFERENCE_SAMPLE_RATE; // 48 kHz — the rate the verbatim coeffs are quoted at.

/** Generate a sine of `frequencyHz` at amplitude `amp` (1 = 0 dBFS) for `seconds`. */
function sine(frequencyHz: number, amp: number, seconds: number, sampleRate = SR): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
  }
  return out;
}

function channel(ch: LoudnessChannel, samples: Float32Array): LoudnessChannelInput {
  return { channel: ch, samples };
}

describe("loudness-core — ITU-R BS.1770-5 K-weighting & loudness", () => {
  it("CALIBRATION (load-bearing): 0 dBFS 997 Hz sine on L, C, or R reads -3.01 LKFS", () => {
    // ITU-R BS.1770-5 Annex 1, p.7: the -0.691 constant cancels the K-weighting
    // gain at 997 Hz so a 0 dBFS 997 Hz sine on L, C, OR R reads exactly
    // -3.01 LKFS. This is the single-channel per-channel reading (the K-gain at
    // 997 Hz is +0.691 dB, the offset is -0.691, leaving 10log10(0.5) = -3.01).
    const seconds = 2; // long enough for IIR transient to settle into steady state
    const tone = sine(997, 1.0, seconds);
    for (const ch of ["L", "C", "R"] as const) {
      const loudness = integratedUngatedLoudness([channel(ch, tone)], SR);
      expect(loudness).toBeCloseTo(-3.01, 1);
    }
  });

  it("three identical 0 dBFS 997 Hz channels sum to -3.01 + 10log10(3) LKFS", () => {
    // Loudness sums in the power domain (Annex 1, p.14, phase-independent), so
    // three coherent equal channels add +10log10(3) ≈ +4.77 dB over one.
    const tone = sine(997, 1.0, 2);
    const triple = integratedUngatedLoudness([channel("L", tone), channel("C", tone), channel("R", tone)], SR);
    expect(triple).toBeCloseTo(-3.01 + 10 * Math.log10(3), 1);
  });

  it("a -20 dBFS 997 Hz tone reads ~ -23 LKFS (20 dB below the 0 dBFS reading)", () => {
    const amp = 10 ** (-20 / 20); // -20 dBFS
    const tone = sine(997, amp, 2);
    const loudness = integratedUngatedLoudness([channel("C", tone)], SR);
    // -3.01 at 0 dBFS, so -20 dB → about -23 LKFS.
    expect(loudness).toBeGreaterThan(-23.5);
    expect(loudness).toBeLessThan(-22.5);
  });

  it("single-channel 0 dBFS 997 Hz reads ~3 dB quieter than the 3-channel case", () => {
    const tone = sine(997, 1.0, 2);
    const mono = integratedUngatedLoudness([channel("C", tone)], SR);
    const triple = integratedUngatedLoudness([channel("L", tone), channel("C", tone), channel("R", tone)], SR);
    // Three equal channels = 3× the power = +10log10(3) ≈ +4.77 dB over one.
    expect(triple - mono).toBeCloseTo(10 * Math.log10(3), 1);
  });

  it("exposes the verbatim 48 kHz K-weighting coefficients (Tables 1 & 2)", () => {
    expect(K_WEIGHTING_STAGE1_48K).toEqual({
      b0: 1.53512485958697,
      b1: -2.69169618940638,
      b2: 1.19839281085285,
      a1: -1.69065929318241,
      a2: 0.73248077421585,
    });
    expect(K_WEIGHTING_STAGE2_48K).toEqual({
      b0: 1.0,
      b1: -2.0,
      b2: 1.0,
      a1: -1.99004745483398,
      a2: 0.99007225036621,
    });
  });

  it("K-weighting boosts high frequencies relative to low (head-shelf + RLB HP)", () => {
    // The K filter is a high-shelf followed by a high-pass: a high-frequency
    // tone passes through with more gain than a low-frequency tone.
    const measureGain = (freq: number): number => {
      const filter = new KWeightingFilter(SR);
      const input = sine(freq, 1.0, 1);
      let inPow = 0;
      let outPow = 0;
      // Skip the first 4800 samples (transient) to read steady-state gain.
      for (let i = 0; i < input.length; i++) {
        const y = filter.process(input[i]);
        if (i >= 4800) {
          inPow += input[i] * input[i];
          outPow += y * y;
        }
      }
      return 10 * Math.log10(outPow / inPow);
    };
    const lowGain = measureGain(100);
    const highGain = measureGain(10_000);
    expect(highGain).toBeGreaterThan(lowGain);
    // RLB high-pass strongly attenuates 100 Hz.
    expect(lowGain).toBeLessThan(0);
    // Head shelf adds ~+4 dB at high frequency.
    expect(highGain).toBeGreaterThan(2);
  });

  it("kWeightingCoefficients returns the verbatim coeffs unchanged at 48 kHz", () => {
    expect(kWeightingCoefficients(SR, K_WEIGHTING_STAGE1_48K)).toEqual(K_WEIGHTING_STAGE1_48K);
    expect(kWeightingCoefficients(SR, K_WEIGHTING_STAGE2_48K)).toEqual(K_WEIGHTING_STAGE2_48K);
  });

  it("re-derives 44.1 kHz coefficients that preserve the 997 Hz calibration", () => {
    // The re-derived filter must give the SAME response, so the -3.01 LKFS
    // calibration must hold at 44.1 kHz too (Annex 1, p.5).
    const sr = 44_100;
    const tone = sine(997, 1.0, 2, sr);
    const loudness = integratedUngatedLoudness([channel("C", tone)], sr);
    expect(loudness).toBeCloseTo(-3.01, 1);
  });

  it("channel weights match Table 3 (L/R/C=1.0, Ls/Rs=1.41, LFE excluded)", () => {
    expect(CHANNEL_WEIGHTS.L).toBe(1.0);
    expect(CHANNEL_WEIGHTS.R).toBe(1.0);
    expect(CHANNEL_WEIGHTS.C).toBe(1.0);
    expect(CHANNEL_WEIGHTS.Ls).toBe(1.41);
    expect(CHANNEL_WEIGHTS.Rs).toBe(1.41);
    expect(CHANNEL_WEIGHTS.LFE).toBe(0);
  });

  it("excludes the LFE channel from the loudness sum", () => {
    const tone = sine(997, 1.0, 2);
    const withoutLfe = integratedUngatedLoudness([channel("C", tone)], SR);
    const withLfe = integratedUngatedLoudness([channel("C", tone), channel("LFE", tone)], SR);
    expect(withLfe).toBeCloseTo(withoutLfe, 6);
  });

  it("powerSumToLoudness applies -0.691 + 10log10 and returns -Infinity for silence", () => {
    expect(powerSumToLoudness(1)).toBeCloseTo(LOUDNESS_OFFSET, 10);
    expect(powerSumToLoudness(0)).toBe(-Infinity);
    expect(powerSumToLoudness(-1)).toBe(-Infinity);
  });
});

describe("loudness-core — integrated gating (ITU-R BS.1770-5 Annex 1)", () => {
  it("a loud half + silent half integrates to ~the loud half, not the average", () => {
    // 3 s of 0 dBFS tone followed by 3 s of silence. The relative gate (-10 LU)
    // drops the silent blocks, so the integrated loudness tracks the loud half.
    const loud = sine(997, 1.0, 3);
    const silent = new Float32Array(Math.round(3 * SR));
    const concat = (a: Float32Array, b: Float32Array) => {
      const out = new Float32Array(a.length + b.length);
      out.set(a, 0);
      out.set(b, a.length);
      return out;
    };
    const sig = concat(loud, silent);
    const integrated = integratedLoudness([channel("C", sig)], SR);
    const loudOnly = integratedLoudness([channel("C", loud)], SR);
    // The relative gate (-10 LU) drops the silent half entirely; only the
    // transition blocks straddling the loud→silent boundary (75% overlap)
    // carry partial energy, so the integrated value sits a few tenths of a dB
    // below the pure-loud reading — NOT ~3 dB below (the naive whole-signal
    // average), which is the property under test.
    expect(integrated).toBeGreaterThan(loudOnly - 0.5);
    expect(integrated).toBeLessThanOrEqual(loudOnly);
    // The naive linear average of half-full-scale-power + half-silence would be
    // 10log10(0.5) ≈ 3 dB below loudOnly; the gate keeps us well above that.
    expect(integrated).toBeGreaterThan(loudOnly - 3 + 1);
  });

  it("excludes blocks below the -70 LKFS absolute gate (all silence → -Infinity)", () => {
    const silent = new Float32Array(Math.round(2 * SR));
    const integrated = integratedLoudness([channel("L", silent), channel("C", silent), channel("R", silent)], SR);
    expect(integrated).toBe(-Infinity);
  });

  it("a steady tone's integrated loudness matches its ungated loudness (-3.01 LKFS)", () => {
    const tone = sine(997, 1.0, 3);
    const integrated = integratedLoudness([channel("C", tone)], SR);
    expect(integrated).toBeCloseTo(-3.01, 1);
  });
});

describe("loudness-core — monotonicity & properties", () => {
  it("PROPERTY: louder input always yields higher integrated loudness", () => {
    const amps = [0.01, 0.1, 0.3, 0.6, 1.0];
    let prev = -Infinity;
    for (const amp of amps) {
      const tone = sine(997, amp, 2);
      const l = integratedLoudness([channel("C", tone)], SR);
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
  });

  it("PROPERTY: a 1 dB level increase produces ~1 LKFS increase (LKFS == dB)", () => {
    const base = sine(997, 0.5, 2);
    const louder = sine(997, 0.5 * 10 ** (1 / 20), 2); // +1 dB
    const lBase = integratedUngatedLoudness([channel("C", base)], SR);
    const lLoud = integratedUngatedLoudness([channel("C", louder)], SR);
    expect(lLoud - lBase).toBeCloseTo(1, 1);
  });
});

describe("loudness-core — loudness range (EBU Tech 3342)", () => {
  it("a steady tone has near-zero LRA", () => {
    const tone = sine(997, 1.0, 10);
    const lra = loudnessRange([channel("C", tone)], SR);
    expect(lra).toBeGreaterThanOrEqual(0);
    expect(lra).toBeLessThan(1);
  });

  it("a quiet passage followed by a loud passage has a positive LRA", () => {
    const quiet = sine(997, 0.1, 6); // -20 dBFS
    const loud = sine(997, 1.0, 6); // 0 dBFS
    const concat = new Float32Array(quiet.length + loud.length);
    concat.set(quiet, 0);
    concat.set(loud, quiet.length);
    const lra = loudnessRange([channel("C", concat)], SR);
    expect(lra).toBeGreaterThan(5);
  });
});
