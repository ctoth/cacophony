import { describe, expect, it } from "vitest";

import {
  DATTORRO_INV_SQRT2,
  lagrangeCubic,
  lagrangeLinear,
  MODULATED_DELAY_DEFAULTS,
  type ModulatedDelayParams,
  ModulatedDelayProcessor,
} from "./modulated-delay-core";

const SAMPLE_RATE = 48000;

/** A pure delay/echo parameter set: blend=1, feedforward=1, no modulation/feedback. */
function delayParams(overrides: Partial<ModulatedDelayParams> = {}): ModulatedDelayParams {
  return {
    delayTime: 0,
    depth: 0,
    rate: 0,
    feedback: 0,
    blend: 1,
    feedforward: 1,
    interpolation: "cubic",
    ...overrides,
  };
}

/** Drive a single impulse (amplitude 1 at sample 0) through `total` samples, return the output. */
function impulseResponse(proc: ModulatedDelayProcessor, params: ModulatedDelayParams, total: number): Float32Array {
  const out = new Float32Array(total);
  const block = new Float32Array(total);
  block[0] = 1;
  proc.process(block, out, params);
  return out;
}

describe("Lagrange linear interpolation (Laakso Eq.43, N=1)", () => {
  it("h0 = 1 - d, h1 = d (closed form)", () => {
    for (const d of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999]) {
      const [h0, h1] = lagrangeLinear(d);
      expect(h0).toBeCloseTo(1 - d, 12);
      expect(h1).toBeCloseTo(d, 12);
    }
  });

  it("partition of unity: coefficients sum to 1 (DC gain = 1)", () => {
    for (const d of [0, 0.3, 0.5, 0.7, 1]) {
      const [h0, h1] = lagrangeLinear(d);
      expect(h0 + h1).toBeCloseTo(1, 12);
    }
  });

  it("d = 0 picks the first tap exactly; d -> 1 picks the second", () => {
    expect(lagrangeLinear(0)).toEqual([1, 0]);
    const [h0, h1] = lagrangeLinear(1);
    expect(h0).toBeCloseTo(0, 12);
    expect(h1).toBeCloseTo(1, 12);
  });
});

describe("Lagrange cubic interpolation (Laakso N=3 table, D = 1 + d)", () => {
  it("coefficients sum to 1 for all fractions (DC gain = 1)", () => {
    for (const d of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999]) {
      const [h0, h1, h2, h3] = lagrangeCubic(d);
      expect(h0 + h1 + h2 + h3).toBeCloseTo(1, 12);
    }
  });

  it("d = 0 selects tap index 1 exactly (impulse at the integer tap)", () => {
    // D = 1 + 0 = 1, so the 4-tap Lagrange must collapse to a unit at tap 1.
    const [h0, h1, h2, h3] = lagrangeCubic(0);
    expect(h0).toBeCloseTo(0, 12);
    expect(h1).toBeCloseTo(1, 12);
    expect(h2).toBeCloseTo(0, 12);
    expect(h3).toBeCloseTo(0, 12);
  });

  it("matches the closed-form Laakso N=3 polynomial table at d = 0.5", () => {
    const d = 0.5;
    const D = 1 + d;
    const expected = [
      (-(D - 1) * (D - 2) * (D - 3)) / 6,
      (D * (D - 2) * (D - 3)) / 2,
      (-D * (D - 1) * (D - 3)) / 2,
      (D * (D - 1) * (D - 2)) / 6,
    ];
    const got = lagrangeCubic(d);
    for (let k = 0; k < 4; k++) {
      expect(got[k]).toBeCloseTo(expected[k], 12);
    }
  });

  it("interpolates a half-sample delay of a ramp between the two center taps", () => {
    // Linear ramp values at taps [-1, 0, 1, 2] = [0, 1, 2, 3]; D=1.5 -> value 1.5.
    const [h0, h1, h2, h3] = lagrangeCubic(0.5);
    const interp = h0 * 0 + h1 * 1 + h2 * 2 + h3 * 3;
    expect(interp).toBeCloseTo(1.5, 10);
  });
});

describe("ModulatedDelayProcessor — integer-delay impulse exactness", () => {
  it("reproduces an impulse EXACTLY at the integer delay offset (cubic, depth 0)", () => {
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    // 10 samples at 48 kHz.
    const delaySamples = 10;
    const delayMs = (delaySamples / SAMPLE_RATE) * 1000;
    const out = impulseResponse(proc, delayParams({ delayTime: delayMs, blend: 0 }), 64);
    // blend=0 so dry is removed; feedforward=1 puts the wet tap at exactly offset N.
    expect(out[delaySamples]).toBeCloseTo(1, 6);
    // Neighbours are ~0 (no smearing at an integer delay).
    expect(out[delaySamples - 1]).toBeCloseTo(0, 6);
    expect(out[delaySamples + 1]).toBeCloseTo(0, 6);
  });

  it("linear interpolation also reproduces an integer-delay impulse exactly", () => {
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const delaySamples = 8;
    const delayMs = (delaySamples / SAMPLE_RATE) * 1000;
    const out = impulseResponse(proc, delayParams({ delayTime: delayMs, blend: 0, interpolation: "linear" }), 64);
    expect(out[delaySamples]).toBeCloseTo(1, 6);
  });

  it("blend passes the dry signal through at sample 0", () => {
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const out = impulseResponse(proc, delayParams({ delayTime: 1, blend: 1, feedforward: 0 }), 16);
    expect(out[0]).toBeCloseTo(1, 6);
  });
});

describe("ModulatedDelayProcessor — fractional delay interpolation", () => {
  it("a half-sample delay smears the impulse across the two center taps", () => {
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    // 5.5-sample delay. The desired sample sits between offset 5 (newer) and
    // offset 6 (older), so the cubic interpolator's two LARGEST (center) taps
    // weight output indices 5 and 6; outer taps (indices 4, 7) carry the small
    // Lagrange ringing lobes.
    const delayMs = (5.5 / SAMPLE_RATE) * 1000;
    const out = impulseResponse(proc, delayParams({ delayTime: delayMs, blend: 0 }), 32);
    // No single tap is unity; the bulk of the energy lands on the two center taps.
    expect(out[5]).toBeGreaterThan(0.1);
    expect(out[6]).toBeGreaterThan(0.1);
    expect(Math.abs(out[5])).toBeLessThan(1);
    // Total energy is preserved (DC gain 1) — the sum of taps ~= 1.
    const sum = out.reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 4);
  });

  it("ORACLE: a non-integer delay of a linear ramp equals x[n - delay] EXACTLY (cubic)", () => {
    // A cubic Lagrange FIR reproduces a linear ramp with zero error (a degree-1
    // polynomial is in the degree-3 interpolant's exact-fit set). So a delay of
    // delaySamples applied to ramp x[n] = n must yield y[n] = n - delaySamples
    // wherever the read window is fully inside the recorded ramp. This is a
    // DIRECTIONAL oracle: a tap-direction sign error shows up as a 2*frac offset.
    for (const delaySamples of [10.25, 20.5, 30.75]) {
      const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
      const total = 96;
      const ramp = new Float32Array(total);
      for (let i = 0; i < total; i++) ramp[i] = i;
      const out = new Float32Array(total);
      const delayMs = (delaySamples / SAMPLE_RATE) * 1000;
      proc.process(ramp, out, delayParams({ delayTime: delayMs, blend: 0, feedforward: 1 }));

      // Check a window well clear of the startup transient (before the delay's
      // tap window has fully entered the ramp) and the buffer edges.
      for (let n = 50; n < 80; n++) {
        const ideal = n - delaySamples; // x[n - delay]; ramp value == index
        expect(out[n]).toBeCloseTo(ideal, 6);
      }
    }
  });

  it("ORACLE: a non-integer delay of a linear ramp equals x[n - delay] EXACTLY (linear)", () => {
    // Linear (N=1) Lagrange also reproduces a linear ramp exactly. Same
    // directional oracle for the linear interpolation path.
    for (const delaySamples of [10.25, 20.5, 30.75]) {
      const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
      const total = 96;
      const ramp = new Float32Array(total);
      for (let i = 0; i < total; i++) ramp[i] = i;
      const out = new Float32Array(total);
      const delayMs = (delaySamples / SAMPLE_RATE) * 1000;
      proc.process(ramp, out, delayParams({ delayTime: delayMs, blend: 0, feedforward: 1, interpolation: "linear" }));

      for (let n = 50; n < 80; n++) {
        const ideal = n - delaySamples;
        expect(out[n]).toBeCloseTo(ideal, 6);
      }
    }
  });

  it("THROUGH-ZERO: a 0-sample delay (linear) returns the current sample (Dattorro p.775)", () => {
    // Dattorro p.775: flangers sweep delay to absolute zero; Table 7 vibrato/flange
    // onset is 0 ms. At delay 0 the wet tap IS the just-written current sample, so
    // a 100% wet, unity-feedforward, linear path reproduces the input verbatim.
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const total = 32;
    const ramp = new Float32Array(total);
    for (let i = 0; i < total; i++) ramp[i] = i + 1; // distinct nonzero values
    const out = new Float32Array(total);
    proc.process(ramp, out, delayParams({ delayTime: 0, blend: 0, feedforward: 1, interpolation: "linear" }));
    for (let n = 0; n < total; n++) {
      expect(out[n]).toBeCloseTo(ramp[n], 6);
    }
  });

  it("THROUGH-ZERO: a flanger sweeping delay down to 0 stays finite and bounded", () => {
    // depth >= delayTime so the modulated read pointer reaches 0 each LFO cycle.
    // Must not produce NaN/Inf or read out of bounds; cubic degrades to linear at
    // the head (intDelay < 1) so no future-sample tap is read.
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const delaySamples = 30;
    const depthSamples = 30; // sweeps the delay through 0
    const delayMs = (delaySamples / SAMPLE_RATE) * 1000;
    const depthMs = (depthSamples / SAMPLE_RATE) * 1000;
    const N = 4096;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * 40 * i) / N);
    const out = new Float32Array(N);
    proc.process(
      input,
      out,
      delayParams({
        delayTime: delayMs,
        depth: depthMs,
        rate: 5,
        blend: DATTORRO_INV_SQRT2,
        feedforward: DATTORRO_INV_SQRT2,
        feedback: -DATTORRO_INV_SQRT2,
      }),
    );
    let max = 0;
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      max = Math.max(max, Math.abs(v));
    }
    expect(max).toBeGreaterThan(0); // non-vacuous: it actually produced signal
    expect(max).toBeLessThan(4);
  });

  it("THROUGH-ZERO: cubic at intDelay=0 falls back to linear (no out-of-bounds, no NaN)", () => {
    // A 0.5-sample delay requested with cubic: intDelay=0, so the cubic newest tap
    // (intDelay-1) would be a future sample. The core falls back to linear there,
    // giving a clean 0.5-sample interpolation of the two head samples.
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const total = 16;
    const ramp = new Float32Array(total);
    for (let i = 0; i < total; i++) ramp[i] = i + 1;
    const out = new Float32Array(total);
    const delayMs = (0.5 / SAMPLE_RATE) * 1000;
    proc.process(ramp, out, delayParams({ delayTime: delayMs, blend: 0, feedforward: 1, interpolation: "cubic" }));
    // y[n] = linear interp of x[n] (offset 0) and x[n-1] (offset 1) at frac 0.5.
    // For n >= 1: 0.5*ramp[n] + 0.5*ramp[n-1]. All finite, in range.
    for (let n = 1; n < total; n++) {
      expect(Number.isFinite(out[n])).toBe(true);
      expect(out[n]).toBeCloseTo(0.5 * ramp[n] + 0.5 * ramp[n - 1], 6);
    }
  });
});

describe("ModulatedDelayProcessor — feedback energy bounded (Dattorro |fb| < 1)", () => {
  it("a feedback echo train decays for |feedback| < 1", () => {
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const delaySamples = 16;
    const delayMs = (delaySamples / SAMPLE_RATE) * 1000;
    const params = delayParams({ delayTime: delayMs, blend: 0, feedforward: 1, feedback: 0.5 });
    const out = impulseResponse(proc, params, 16 * 6 + 8);
    // Successive echoes at multiples of the delay decay by ~feedback each hop.
    const echo1 = Math.abs(out[delaySamples]);
    const echo2 = Math.abs(out[delaySamples * 2]);
    const echo3 = Math.abs(out[delaySamples * 3]);
    expect(echo1).toBeGreaterThan(0);
    expect(echo2).toBeLessThan(echo1);
    expect(echo3).toBeLessThan(echo2);
    // Roughly geometric with ratio 0.5.
    expect(echo2 / echo1).toBeCloseTo(0.5, 1);
  });

  it("does not blow up over a long run at feedback = 0.9", () => {
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const delayMs = (32 / SAMPLE_RATE) * 1000;
    const params = delayParams({ delayTime: delayMs, blend: 0, feedforward: 1, feedback: 0.9 });
    const out = impulseResponse(proc, params, 4096);
    let max = 0;
    for (const v of out) max = Math.max(max, Math.abs(v));
    expect(Number.isFinite(max)).toBe(true);
    expect(max).toBeLessThan(2);
  });

  it("ORACLE: feedback is NEGATIVE (Dattorro Fig.36 subtracting summer) — echoes alternate sign", () => {
    // The figure's left summer SUBTRACTS the feedback: w[n] = x[n] - feedback*w[n-M],
    // realizing the paper's denominator 1 + feedback*z^-M (p.776). For a unit impulse
    // the delay-line state is w[0]=1, w[M]=-0.5, w[2M]=+0.25, w[3M]=-0.125. The wet
    // output reads the tap at delay M (blend=0, feedforward=1), so out[kM] = w[(k-1)M]:
    //   out[M]=1, out[2M]=-0.5, out[3M]=+0.25, out[4M]=-0.125 — ALTERNATING sign.
    // The old additive summer (w = x + fb) would give all-POSITIVE echoes
    // (out[2M]=+0.5, out[3M]=+0.25, ...) — so this signed assertion is RED on the
    // bug, GREEN on the fix.
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const M = 16; // integer delay so the echoes land on exact taps
    const delayMs = (M / SAMPLE_RATE) * 1000;
    const params = delayParams({ delayTime: delayMs, blend: 0, feedforward: 1, feedback: 0.5 });
    const out = impulseResponse(proc, params, M * 5 + 4);
    expect(out[M]).toBeCloseTo(1, 6);
    expect(out[M * 2]).toBeCloseTo(-0.5, 6);
    expect(out[M * 3]).toBeCloseTo(0.25, 6);
    expect(out[M * 4]).toBeCloseTo(-0.125, 6);
  });

  it("ORACLE: white-chorus allpass property |H| ~= 1 (Dattorro p.776)", () => {
    // p.776: |H| = 1 when the modulating tap sits on the same (integer) center as
    // the feedback tap (frac=0, depth=0), blend = feedback, feedforward = 1. With
    // the corrected subtracting summer H(z) = (blend + z^-M)/(1 + blend*z^-M) is a
    // pure allpass (blend = feedback), so a settled sine emerges at unity RMS.
    // The old additive summer makes the denominator 1 - blend*z^-M -> NOT allpass.
    const M = 20; // integer center
    const delayMs = (M / SAMPLE_RATE) * 1000;
    const blend = DATTORRO_INV_SQRT2;
    const params = delayParams({
      delayTime: delayMs,
      depth: 0,
      blend,
      feedforward: 1,
      feedback: blend,
    });

    for (const cyclesPerBuffer of [8, 17, 33]) {
      const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
      const N = 8192;
      const input = new Float32Array(N);
      for (let i = 0; i < N; i++) input[i] = Math.sin((2 * Math.PI * cyclesPerBuffer * i) / N);
      const out = new Float32Array(N);
      proc.process(input, out, params);

      // Measure RMS over the settled second half (skip the startup transient).
      const start = N / 2;
      let inSq = 0;
      let outSq = 0;
      for (let i = start; i < N; i++) {
        inSq += input[i] * input[i];
        outSq += out[i] * out[i];
      }
      const inRms = Math.sqrt(inSq / (N - start));
      const outRms = Math.sqrt(outSq / (N - start));
      // Flat magnitude (|H| ~= 1): output RMS matches input RMS closely.
      expect(outRms / inRms).toBeCloseTo(1, 2);
    }
  });
});

describe("ModulatedDelayProcessor — LFO sweep min/max", () => {
  it("with depth > 0 the modulated read delay sweeps between delayTime +/- depth", () => {
    // Drive a long impulse train of unit DC and detect that the effective delay
    // changes over time by tracking where a lone impulse lands at two LFO phases.
    const delaySamplesNominal = 100;
    const delayMs = (delaySamplesNominal / SAMPLE_RATE) * 1000;
    const depthSamples = 40;
    const depthMs = (depthSamples / SAMPLE_RATE) * 1000;
    const rate = 1; // 1 Hz

    // Phase at +pi/2 (sin = +1) -> max delay; phase at -pi/2 (sin = -1) -> min delay.
    const procMax = new ModulatedDelayProcessor(SAMPLE_RATE, Math.PI / 2);
    const outMax = impulseResponse(procMax, delayParams({ delayTime: delayMs, depth: depthMs, rate, blend: 0 }), 256);

    const procMin = new ModulatedDelayProcessor(SAMPLE_RATE, -Math.PI / 2);
    const outMin = impulseResponse(procMin, delayParams({ delayTime: delayMs, depth: depthMs, rate, blend: 0 }), 256);

    const peakMax = argmaxAbs(outMax);
    const peakMin = argmaxAbs(outMin);
    // sin=+1 lands near nominal+depth; sin=-1 near nominal-depth.
    expect(peakMax).toBeGreaterThan(delaySamplesNominal + depthSamples - 4);
    expect(peakMin).toBeLessThan(delaySamplesNominal - depthSamples + 4);
    expect(peakMax).toBeGreaterThan(peakMin);
  });
});

describe("ModulatedDelayProcessor — vibrato topology endpoints", () => {
  it("vibrato preset (blend=0, ff=1, fb=0) is 100% wet (no dry path at sample 0)", () => {
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const delayMs = (20 / SAMPLE_RATE) * 1000;
    const out = impulseResponse(proc, delayParams({ delayTime: delayMs, blend: 0, feedforward: 1 }), 64);
    // No dry component at t=0; all energy is in the delayed wet tap.
    expect(Math.abs(out[0])).toBeCloseTo(0, 6);
    expect(Math.abs(out[20])).toBeGreaterThan(0.5);
  });

  it("reset() clears the delay line", () => {
    const proc = new ModulatedDelayProcessor(SAMPLE_RATE);
    const delayMs = (10 / SAMPLE_RATE) * 1000;
    impulseResponse(proc, delayParams({ delayTime: delayMs, blend: 0 }), 64);
    proc.reset();
    const out = new Float32Array(64);
    proc.process(new Float32Array(64), out, delayParams({ delayTime: delayMs, blend: 0 }));
    for (const v of out) expect(v).toBeCloseTo(0, 6);
  });
});

describe("MODULATED_DELAY_DEFAULTS — pinned single source of truth", () => {
  it("matches the documented defaults", () => {
    expect(MODULATED_DELAY_DEFAULTS).toEqual({
      delayTime: 5,
      depth: 0,
      rate: 0.5,
      feedback: 0,
      blend: 1,
      feedforward: DATTORRO_INV_SQRT2,
      interpolation: "cubic",
    });
  });

  it("pins the Dattorro Table 6 1/sqrt(2) constant to the paper's printed value", () => {
    // The paper (p.775) prints 0.7071 verbatim (q23 4-decimal quantization), NOT
    // the full-precision Math.SQRT1_2. Lock the shipped value to the table digit.
    // biome-ignore lint/suspicious/noApproximativeNumericConstant: this test EXISTS to pin the literal 0.7071 from Dattorro Table 6; Math.SQRT1_2 would defeat its purpose.
    expect(DATTORRO_INV_SQRT2).toBe(0.7071);
  });
});

/** Index of the largest-magnitude sample. */
function argmaxAbs(signal: Float32Array): number {
  let best = 0;
  let bestVal = -1;
  for (let i = 0; i < signal.length; i++) {
    const v = Math.abs(signal[i]);
    if (v > bestVal) {
      bestVal = v;
      best = i;
    }
  }
  return best;
}
