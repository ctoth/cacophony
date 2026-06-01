import { describe, expect, it } from "vitest";

import { ADAA_EPS, adaaSample, shapeFunctions, type WaveshaperParams, WaveshaperProcessor } from "./waveshaper-core";

/** Closed-form eq.9 reference: (F0(xn) - F0(xPrev)) / (xn - xPrev). */
function closedFormADAA(xn: number, xPrev: number, shape: "hardclip" | "tanh"): number {
  const { f0 } = shapeFunctions(shape);
  return (f0(xn) - f0(xPrev)) / (xn - xPrev);
}

describe("waveshaper-core: nonlinearity closed forms (Parker 2016 eqs 20, 24-25)", () => {
  it("tanh f0 = log(cosh(x)) passes through the origin (F0(0)=0)", () => {
    const { f0 } = shapeFunctions("tanh");
    expect(f0(0)).toBeCloseTo(0, 12);
  });

  it("tanh f0 matches log(cosh) for moderate x and stays finite for huge x (overflow-stable)", () => {
    const { f0 } = shapeFunctions("tanh");
    for (const x of [-3, -1, -0.25, 0.5, 2, 4]) {
      expect(f0(x)).toBeCloseTo(Math.log(Math.cosh(x)), 9);
    }
    // Naive Math.log(Math.cosh(1000)) is Infinity; the stable form must be finite.
    expect(Number.isFinite(f0(1000))).toBe(true);
    expect(Number.isFinite(f0(-1000))).toBe(true);
  });

  it("hard-clip f0 passes through the origin and is continuous at the +/-1 knees", () => {
    const { f0 } = shapeFunctions("hardclip");
    expect(f0(0)).toBeCloseTo(0, 12);
    // both branches yield 1/2 at the knee
    expect(f0(1)).toBeCloseTo(0.5, 12);
    expect(f0(-1)).toBeCloseTo(0.5, 12);
    // |x| - 1/2 branch beyond the knee
    expect(f0(2)).toBeCloseTo(1.5, 12);
    expect(f0(-2)).toBeCloseTo(1.5, 12);
  });

  it("hard-clip f saturates beyond +/-1 and is identity within", () => {
    const { f } = shapeFunctions("hardclip");
    expect(f(0.5)).toBeCloseTo(0.5, 12);
    expect(f(5)).toBe(1);
    expect(f(-5)).toBe(-1);
  });

  it("tanh f is monotonic and bounded in (-1, 1)", () => {
    const { f } = shapeFunctions("tanh");
    let prev = -Infinity;
    for (let x = -8; x <= 8; x += 0.01) {
      const y = f(x);
      expect(y).toBeGreaterThan(-1);
      expect(y).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(prev); // monotone non-decreasing
      prev = y;
    }
  });
});

describe("waveshaper-core: adaaSample eq.9 quotient", () => {
  it("hard-clip: equals the closed-form (F0(xn)-F0(xPrev))/(xn-xPrev) for a hand sequence", () => {
    const pairs: Array<[number, number]> = [
      [0.5, 0.2],
      [2.0, 0.5],
      [-1.5, 2.0],
      [3.0, -3.0],
    ];
    for (const [xn, xPrev] of pairs) {
      expect(adaaSample(xn, xPrev, "hardclip")).toBeCloseTo(closedFormADAA(xn, xPrev, "hardclip"), 10);
    }
  });

  it("tanh: equals the closed-form (F0(xn)-F0(xPrev))/(xn-xPrev) for a hand sequence", () => {
    const pairs: Array<[number, number]> = [
      [0.5, 0.2],
      [1.5, -0.5],
      [-2.0, 0.7],
      [0.9, -0.9],
    ];
    for (const [xn, xPrev] of pairs) {
      expect(adaaSample(xn, xPrev, "tanh")).toBeCloseTo(closedFormADAA(xn, xPrev, "tanh"), 10);
    }
  });
});

describe("waveshaper-core: eq.10 singularity fallback", () => {
  it("equal consecutive samples return f(x) exactly (no NaN/Inf) — hard clip", () => {
    const { f } = shapeFunctions("hardclip");
    for (const x of [0, 0.5, 2.0, -3.0]) {
      const y = adaaSample(x, x, "hardclip");
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeCloseTo(f(x), 12);
    }
  });

  it("near-equal consecutive samples return ~= f(midpoint) (no NaN/Inf) — tanh", () => {
    const { f } = shapeFunctions("tanh");
    const x = 0.73;
    const xn = x + ADAA_EPS / 10; // within eps -> fallback engages
    const y = adaaSample(xn, x, "tanh");
    expect(Number.isFinite(y)).toBe(true);
    expect(y).toBeCloseTo(f((xn + x) / 2), 6);
  });

  it("the eq.9 quotient approaches f(midpoint) as xn -> xPrev (continuity of eq.10)", () => {
    // Just OUTSIDE eps so eq.9 runs; it should be close to the midpoint value.
    const { f } = shapeFunctions("tanh");
    const xPrev = 0.4;
    const xn = xPrev + 1e-3;
    const eq9 = adaaSample(xn, xPrev, "tanh", 1e-9);
    expect(eq9).toBeCloseTo(f((xn + xPrev) / 2), 4);
  });
});

describe("waveshaper-core: WaveshaperProcessor (stateful, per-channel)", () => {
  const baseParams = (over: Partial<WaveshaperParams> = {}): WaveshaperParams => ({
    drive: 1,
    shape: "hardclip",
    mix: 1,
    output: 1,
    ...over,
  });

  it("constant input produces f(drive*x) exactly via the fallback path", () => {
    const proc = new WaveshaperProcessor();
    const { f } = shapeFunctions("hardclip");
    const input = new Float32Array(16).fill(2.0);
    const output = new Float32Array(16);
    proc.process(input, output, baseParams({ drive: 1, shape: "hardclip" }));
    // After the first sample (xPrev was 0), every steady sample equals f(2) = 1.
    for (let i = 1; i < output.length; i++) {
      expect(output[i]).toBeCloseTo(f(2.0), 10);
    }
  });

  it("first sample matches the eq.9 quotient from the initial state (xPrev=0)", () => {
    const proc = new WaveshaperProcessor();
    const input = new Float32Array([0.6, 0.6]);
    const output = new Float32Array(2);
    proc.process(input, output, baseParams({ shape: "tanh" }));
    // sample 0: xn=0.6, xPrev=0 -> eq.9. output is a Float32Array so compare at
    // single-precision tolerance against the double-precision closed form.
    expect(output[0]).toBeCloseTo(closedFormADAA(0.6, 0, "tanh"), 6);
  });

  it("mix=0 is a pure dry passthrough", () => {
    const proc = new WaveshaperProcessor();
    const input = new Float32Array([0.1, 0.9, -0.4, 5.0]);
    const output = new Float32Array(4);
    proc.process(input, output, baseParams({ mix: 0, shape: "hardclip", drive: 3 }));
    for (let i = 0; i < input.length; i++) {
      expect(output[i]).toBeCloseTo(input[i], 10);
    }
  });

  it("output gain scales the shaped signal", () => {
    const a = new WaveshaperProcessor();
    const b = new WaveshaperProcessor();
    const input = new Float32Array([0.5, 0.7, 0.9, 1.5]);
    const outUnit = new Float32Array(4);
    const outGain = new Float32Array(4);
    a.process(input, outUnit, baseParams({ shape: "tanh", output: 1 }));
    b.process(input, outGain, baseParams({ shape: "tanh", output: 2 }));
    for (let i = 0; i < 4; i++) {
      expect(outGain[i]).toBeCloseTo(outUnit[i] * 2, 9);
    }
  });

  it("re-priming on shape change keeps the output finite (no stale F0)", () => {
    const proc = new WaveshaperProcessor();
    const input = new Float32Array(8).fill(0.8);
    const out1 = new Float32Array(8);
    const out2 = new Float32Array(8);
    proc.process(input, out1, baseParams({ shape: "hardclip" }));
    proc.process(input, out2, baseParams({ shape: "tanh" }));
    for (const y of out2) expect(Number.isFinite(y)).toBe(true);
  });
});

describe("waveshaper-core: property-style invariants (deterministic sweeps)", () => {
  it("hard-clip ADAA output never exceeds the +/-1 bound for a swept input ramp", () => {
    const proc = new WaveshaperProcessor();
    const N = 4096;
    const input = new Float32Array(N);
    // ramp -8..8 (drive=1) so the nonlinearity is fully exercised in/out of clip
    for (let i = 0; i < N; i++) input[i] = -8 + (16 * i) / (N - 1);
    const output = new Float32Array(N);
    proc.process(input, output, { drive: 1, shape: "hardclip", mix: 1, output: 1 });
    for (const y of output) {
      expect(Number.isFinite(y)).toBe(true);
      // first-order ADAA on a hard clipper is the average of f over the
      // interval, so it cannot exceed the clip bound (allow tiny fp slack).
      expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("tanh ADAA output stays within (-1, 1) for a high-drive sine sweep", () => {
    const proc = new WaveshaperProcessor();
    const N = 8192;
    const input = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // chirp-ish: frequency rises across the buffer
      const phase = (Math.PI * i * i) / N;
      input[i] = Math.sin(phase);
    }
    const output = new Float32Array(N);
    proc.process(input, output, { drive: 10, shape: "tanh", mix: 1, output: 1 });
    for (const y of output) {
      expect(Number.isFinite(y)).toBe(true);
      expect(Math.abs(y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("ADAA average bound: every quotient lies between f(xPrev) and f(xn) for monotone shapes", () => {
    // For a monotone f, the mean value of f over [a,b] (= the eq.9 quotient)
    // lies between f(a) and f(b). Verify across a deterministic grid (tanh).
    const { f } = shapeFunctions("tanh");
    for (let a = -5; a <= 5; a += 0.37) {
      for (let b = a + 0.05; b <= 5; b += 0.53) {
        const q = adaaSample(b, a, "tanh", 1e-9);
        const lo = Math.min(f(a), f(b));
        const hi = Math.max(f(a), f(b));
        expect(q).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(q).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });
});
