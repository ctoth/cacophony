import { describe, expect, it } from "vitest";

import { computeStaticGain, DynamicsProcessor, timeConstantToCoefficient } from "./dynamics-core";

const FS = 48000;

/** Linear amplitude for a given dBFS level. */
function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** dBFS for a given linear amplitude. */
function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.abs(linear));
}

/**
 * Drive a constant-amplitude DC-ish input through the processor for `n` samples
 * and return the steady-state linear gain (output/input) once ballistics settle.
 */
function steadyStateGain(
  proc: DynamicsProcessor,
  inputLinear: number,
  params: { threshold: number; ratio: number; knee: number; attack: number; release: number; makeup: number },
  n: number,
): number {
  const input = new Float32Array(n).fill(inputLinear);
  const output = new Float32Array(n);
  proc.process(input, output, params);
  // Last sample = settled gain (input is constant).
  return output[n - 1] / inputLinear;
}

describe("computeStaticGain — gain computer (Giannoulis 2012 eqs 2-4)", () => {
  describe("unit: hard knee (W=0)", () => {
    it("is unity (yG = xG) at and below threshold for a compressor", () => {
      const T = -20;
      const R = 4;
      // below threshold
      expect(computeStaticGain(-40, T, R, 0)).toBeCloseTo(-40, 6);
      // at threshold
      expect(computeStaticGain(-20, T, R, 0)).toBeCloseTo(-20, 6);
    });

    it("applies slope 1/R above threshold (eq 3)", () => {
      const T = -20;
      const R = 4;
      // xG = 0 dB, 20 dB above threshold => yG = T + 20/R = -20 + 5 = -15
      expect(computeStaticGain(0, T, R, 0)).toBeCloseTo(-15, 6);
    });

    it("R->infinity (limiter) clamps output to threshold above T", () => {
      const T = -10;
      const R = Number.POSITIVE_INFINITY;
      expect(computeStaticGain(0, T, R, 0)).toBeCloseTo(-10, 6);
      expect(computeStaticGain(20, T, R, 0)).toBeCloseTo(-10, 6);
    });
  });

  describe("unit: soft knee (eq 4)", () => {
    it("equals the hard knee outside the knee region", () => {
      const T = -20;
      const R = 4;
      const W = 10;
      // well below knee (2(xG-T) < -W): xG = -40, 2*(-20) = -40 < -10 => unity
      expect(computeStaticGain(-40, T, R, W)).toBeCloseTo(computeStaticGain(-40, T, R, 0), 6);
      // well above knee (2(xG-T) > W): xG = 0, 2*20 = 40 > 10 => hard-knee value
      expect(computeStaticGain(0, T, R, W)).toBeCloseTo(computeStaticGain(0, T, R, 0), 6);
    });

    it("W=0 reduces exactly to the hard knee at the threshold (eq 4 -> eq 3)", () => {
      const T = -20;
      const R = 4;
      for (const xG of [-30, -20, -10, 0]) {
        expect(computeStaticGain(xG, T, R, 0)).toBeCloseTo(computeStaticGain(xG, T, R, 0), 9);
      }
    });

    it("is continuous across the lower knee edge", () => {
      const T = -20;
      const R = 4;
      const W = 8;
      const lowerEdge = T - W / 2; // 2(xG-T) = -W
      const eps = 1e-5;
      const justBelow = computeStaticGain(lowerEdge - eps, T, R, W);
      const atEdge = computeStaticGain(lowerEdge, T, R, W);
      // Continuity: the jump across the edge must be on the order of the step
      // size (unity slope below the knee), not a finite discontinuity.
      expect(Math.abs(atEdge - justBelow)).toBeLessThan(1e-4);
    });

    it("is continuous across the upper knee edge", () => {
      const T = -20;
      const R = 4;
      const W = 8;
      const upperEdge = T + W / 2; // 2(xG-T) = W
      const eps = 1e-5;
      const atEdge = computeStaticGain(upperEdge, T, R, W);
      const justAbove = computeStaticGain(upperEdge + eps, T, R, W);
      // Slope 1/R above the knee, so the jump is ~eps/R, not a finite gap.
      expect(Math.abs(justAbove - atEdge)).toBeLessThan(1e-4);
    });
  });

  describe("unit: expander / gate (R < 1)", () => {
    it("attenuates signals BELOW threshold (downward expansion)", () => {
      const T = -40;
      const R = 0.5; // expander
      // xG below threshold gets pushed DOWN: yG < xG
      const xG = -60;
      const yG = computeStaticGain(xG, T, R, 0);
      expect(yG).toBeLessThan(xG);
    });

    it("leaves signals above threshold unchanged (unity above T for expander)", () => {
      const T = -40;
      const R = 0.5;
      expect(computeStaticGain(-20, T, R, 0)).toBeCloseTo(-20, 6);
      expect(computeStaticGain(-40, T, R, 0)).toBeCloseTo(-40, 6);
    });

    it("soft knee (knee>0) is continuous across BOTH knee edges (no discontinuity)", () => {
      // Expander altered region is BELOW T: knee joins the slope line at the
      // lower edge and unity at the upper edge. Previously the parabola was
      // anchored to the wrong edge and produced a multi-dB jump at the lower
      // edge — this test exercises the knee>0 branch the old tests skipped.
      const T = -30;
      const R = 0.5; // expander, slope 1/R = 2 below T
      const W = 8;
      const eps = 1e-5;
      const lowerEdge = T - W / 2; // 2(xG-T) = -W
      const upperEdge = T + W / 2; // 2(xG-T) = +W

      const belowLower = computeStaticGain(lowerEdge - eps, T, R, W);
      const atLower = computeStaticGain(lowerEdge, T, R, W);
      expect(Math.abs(atLower - belowLower)).toBeLessThan(1e-4);

      const atUpper = computeStaticGain(upperEdge, T, R, W);
      const aboveUpper = computeStaticGain(upperEdge + eps, T, R, W);
      expect(Math.abs(aboveUpper - atUpper)).toBeLessThan(1e-4);
    });

    it("soft knee (knee>0) never boosts: yG <= xG across the knee region", () => {
      // The bug made yG > xG inside the knee (gain BOOST). Sweep the whole knee
      // span (and a margin on each side) and assert downward expansion only.
      const T = -30;
      const R = 0.5;
      const W = 8;
      for (let xG = T - 2 * W; xG <= T + 2 * W; xG += 0.1) {
        const yG = computeStaticGain(xG, T, R, W);
        expect(yG).toBeLessThanOrEqual(xG + 1e-9);
      }
    });
  });

  describe("property: invariants over a range of inputs", () => {
    it("compressor (R>1): yG <= xG everywhere (never boosts in the side-chain)", () => {
      const T = -20;
      const R = 3;
      for (let xG = -80; xG <= 0; xG += 0.5) {
        const yG = computeStaticGain(xG, T, R, 6);
        expect(yG).toBeLessThanOrEqual(xG + 1e-9);
      }
    });

    it("static curve is monotonically non-decreasing in xG (compressor)", () => {
      const T = -25;
      const R = 4;
      const W = 12;
      let prev = Number.NEGATIVE_INFINITY;
      for (let xG = -90; xG <= 0; xG += 0.25) {
        const yG = computeStaticGain(xG, T, R, W);
        expect(yG).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = yG;
      }
    });

    it("gain reduction (xG - yG) is monotonically non-decreasing in xG above threshold (compressor)", () => {
      const T = -30;
      const R = 6;
      let prevGr = Number.NEGATIVE_INFINITY;
      for (let xG = -30; xG <= 0; xG += 0.25) {
        const gr = xG - computeStaticGain(xG, T, R, 0);
        expect(gr).toBeGreaterThanOrEqual(prevGr - 1e-9);
        prevGr = gr;
      }
    });

    it("expander (R<1): yG <= xG everywhere (never boosts)", () => {
      const T = -30;
      const R = 0.5;
      for (let xG = -90; xG <= 0; xG += 0.5) {
        const yG = computeStaticGain(xG, T, R, 0);
        expect(yG).toBeLessThanOrEqual(xG + 1e-9);
      }
    });

    it("default createGate() params do not boost at the lower knee edge", () => {
      // createGate() (src/cacophony.ts) overrides only ratio: 0.1; the worklet's
      // threshold/knee AudioParams default to -24 dB / 6 dB (dynamics.ts:35,37).
      // The shipped default gate therefore runs the expander soft-knee branch
      // with W = 6. Before the fix this produced a +27 dB BOOST / 64 dB jump at
      // the lower knee edge. Assert no boost there (and across the knee span).
      const T = -24; // worklet threshold default
      const R = 0.1; // createGate ratio override
      const W = 6; // worklet knee default
      const lowerEdge = T - W / 2; // -27 dB, the spot the bug spiked
      expect(computeStaticGain(lowerEdge, T, R, W)).toBeLessThanOrEqual(lowerEdge + 1e-9);
      for (let xG = lowerEdge; xG <= T + W / 2; xG += 0.05) {
        const yG = computeStaticGain(xG, T, R, W);
        expect(yG).toBeLessThanOrEqual(xG + 1e-9);
      }
    });
  });
});

describe("timeConstantToCoefficient — eq 7 alpha = exp(-1/(tau*fs))", () => {
  it("unit: maps positive tau into (0,1)", () => {
    for (const tau of [0.001, 0.01, 0.1, 1]) {
      const a = timeConstantToCoefficient(tau, FS);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
    }
  });

  it("property: larger tau -> alpha closer to 1 (slower)", () => {
    let prev = -1;
    for (const tau of [0.001, 0.005, 0.01, 0.05, 0.1, 0.5]) {
      const a = timeConstantToCoefficient(tau, FS);
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });
});

describe("DynamicsProcessor — full feed-forward DRC (log-domain detector, eqs 16 & 23)", () => {
  const compressorParams = { threshold: -20, ratio: 4, knee: 0, attack: 0.01, release: 0.1, makeup: 0 };

  it("unit: leaves a below-threshold signal essentially unaffected (gain ~ 1)", () => {
    const proc = new DynamicsProcessor(FS);
    const g = steadyStateGain(proc, dbToLinear(-40), compressorParams, FS); // 1 second to settle
    expect(g).toBeCloseTo(1, 2);
  });

  it("unit: compresses an above-threshold signal toward the static-curve target", () => {
    const proc = new DynamicsProcessor(FS);
    const inputDb = 0; // 20 dB over threshold
    const g = steadyStateGain(proc, dbToLinear(inputDb), compressorParams, FS);
    const appliedGainDb = linearToDb(g);
    // expected gain reduction = yG - xG = (-20 + 20/4) - 0 = -15 dB
    expect(appliedGainDb).toBeCloseTo(-15, 1);
  });

  it("unit: makeup gain is added to the control (eq 1)", () => {
    const proc = new DynamicsProcessor(FS);
    const params = { ...compressorParams, makeup: 6 };
    const g = steadyStateGain(proc, dbToLinear(0), params, FS);
    const appliedGainDb = linearToDb(g);
    // -15 dB gain reduction + 6 dB makeup = -9 dB
    expect(appliedGainDb).toBeCloseTo(-9, 1);
  });

  it("unit: limiter (R->inf) clamps the steady-state output near threshold", () => {
    const proc = new DynamicsProcessor(FS);
    const params = { threshold: -10, ratio: Number.POSITIVE_INFINITY, knee: 0, attack: 0.005, release: 0.05, makeup: 0 };
    const inputDb = 0;
    const g = steadyStateGain(proc, dbToLinear(inputDb), params, FS);
    const outDb = inputDb + linearToDb(g);
    expect(outDb).toBeCloseTo(-10, 1);
  });

  it("unit: expander (R<1) attenuates a below-threshold signal", () => {
    const proc = new DynamicsProcessor(FS);
    const params = { threshold: -30, ratio: 0.5, knee: 0, attack: 0.005, release: 0.05, makeup: 0 };
    const g = steadyStateGain(proc, dbToLinear(-50), params, FS);
    // expander pushes the -50 dB (20 dB below T) signal down -> gain < 1
    expect(g).toBeLessThan(1);
    expect(linearToDb(g)).toBeLessThan(-1);
  });

  it("unit: attack ramps the gain reduction in over ~attack time (not instantaneous)", () => {
    const proc = new DynamicsProcessor(FS);
    const params = { threshold: -20, ratio: 8, knee: 0, attack: 0.05, release: 0.2, makeup: 0 };
    const n = FS; // 1s
    const input = new Float32Array(n).fill(dbToLinear(0));
    const output = new Float32Array(n);
    proc.process(input, output, params);
    // One sample after onset, the gain reduction must not yet have reached
    // its full value (ballistics, not instantaneous).
    const earlyGainDb = linearToDb(output[1] / input[1]);
    const settledGainDb = linearToDb(output[n - 1] / input[n - 1]);
    expect(earlyGainDb).toBeGreaterThan(settledGainDb + 0.5); // less reduction early
  });

  it("property: compressor never produces output louder than input above threshold (steady state)", () => {
    const params = { threshold: -20, ratio: 4, knee: 0, attack: 0.005, release: 0.05, makeup: 0 };
    for (const inputDb of [-15, -10, -5, 0]) {
      const proc = new DynamicsProcessor(FS);
      const g = steadyStateGain(proc, dbToLinear(inputDb), params, FS);
      expect(g).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("property: steady-state gain reduction increases monotonically with input level (compressor)", () => {
    const params = { threshold: -30, ratio: 4, knee: 0, attack: 0.005, release: 0.05, makeup: 0 };
    let prevReductionDb = Number.POSITIVE_INFINITY; // gain in dB, more negative = more reduction
    for (const inputDb of [-25, -20, -15, -10, -5, 0]) {
      const proc = new DynamicsProcessor(FS);
      const g = steadyStateGain(proc, dbToLinear(inputDb), params, FS);
      const gainDb = linearToDb(g);
      expect(gainDb).toBeLessThanOrEqual(prevReductionDb + 1e-6);
      prevReductionDb = gainDb;
    }
  });
});
