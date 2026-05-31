import { describe, expect, it } from "vitest";

import { buildHadamardMatrix, buildVelvetNoise, type FdnReverbParams, FdnReverbProcessor } from "./fdn-reverb-core";

const FS = 48000;

/** Deterministic linear-congruential RNG in [0,1) so velvet noise is reproducible. */
function makeRng(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG constants.
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const baseParams: FdnReverbParams = {
  decayTime: 1.0,
  preDelay: 0,
  damping: 0,
  diffusion: 0,
  mix: 1,
};

/** Feed an impulse, return the wet output of `n` samples. */
function impulseResponse(proc: FdnReverbProcessor, n: number, params: FdnReverbParams): Float32Array {
  const input = new Float32Array(n);
  input[0] = 1;
  const output = new Float32Array(n);
  proc.process(input, output, params);
  return output;
}

/** Total energy (Σ x²) over a window. */
function energy(buf: Float32Array, start = 0, end = buf.length): number {
  let e = 0;
  for (let i = start; i < end; i++) e += buf[i] * buf[i];
  return e;
}

describe("buildHadamardMatrix — lossless feedback matrix (Schlecht 2019 §III, degree-0 paraunitary)", () => {
  it("unit: produces ±1/√N entries for N=4 and N=8", () => {
    for (const n of [4, 8]) {
      const h = buildHadamardMatrix(n);
      const expectedMag = 1 / Math.sqrt(n);
      for (let i = 0; i < n * n; i++) {
        expect(Math.abs(Math.abs(h[i]) - expectedMag)).toBeLessThan(1e-6);
      }
    }
  });

  it("property: HᵀH = I (orthonormal ⇒ paraunitary ⇒ lossless core)", () => {
    for (const n of [4, 8]) {
      const h = buildHadamardMatrix(n);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          let dot = 0;
          for (let k = 0; k < n; k++) dot += h[k * n + r] * h[k * n + c];
          expect(dot).toBeCloseTo(r === c ? 1 : 0, 5);
        }
      }
    }
  });

  it("rejects non-power-of-two sizes", () => {
    expect(() => buildHadamardMatrix(3)).toThrow();
    expect(() => buildHadamardMatrix(6)).toThrow();
  });
});

describe("buildVelvetNoise — sparse ±1 diffuser (Fagerström 2020 §2.3, eqs 4-7)", () => {
  it("unit: every tap sign is exactly +1 or −1 (eq 6)", () => {
    const taps = buildVelvetNoise(FS, 1000, FS, makeRng());
    for (const t of taps) {
      expect(t.sign === 1 || t.sign === -1).toBe(true);
    }
  });

  it("unit: number of impulses ≈ M = L_s / T_d (eqs 4-5)", () => {
    const lengthSamples = FS; // 1 s
    const density = 1000; // ρ_d pulses/s
    const tdGrid = FS / density; // T_d
    const expectedM = Math.floor(lengthSamples / tdGrid); // M
    const taps = buildVelvetNoise(lengthSamples, density, FS, makeRng());
    // Some taps may round past the end and be dropped; allow ±1.
    expect(Math.abs(taps.length - expectedM)).toBeLessThanOrEqual(1);
  });

  it("property: rendered sequence holds only values in {−1, 0, +1}", () => {
    const length = 4000;
    const taps = buildVelvetNoise(length, 2000, FS, makeRng(7));
    const seq = new Float32Array(length);
    for (const t of taps) seq[t.location] = t.sign;
    for (let i = 0; i < length; i++) {
      expect(seq[i] === -1 || seq[i] === 0 || seq[i] === 1).toBe(true);
    }
  });

  it("property: higher density ρ_d ⇒ more impulses (smaller grid T_d)", () => {
    const length = FS;
    let prev = -1;
    for (const density of [250, 500, 1000, 2000]) {
      const m = buildVelvetNoise(length, density, FS, makeRng(3)).length;
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });

  it("property: taps are unique-ish locations within bounds", () => {
    const length = 2000;
    const taps = buildVelvetNoise(length, 1000, FS, makeRng(11));
    for (const t of taps) {
      expect(t.location).toBeGreaterThanOrEqual(0);
      expect(t.location).toBeLessThan(length);
    }
  });
});

describe("FdnReverbProcessor — FDN reverb core (Schlecht 2019 + Jot 1991 + Fagerström 2020)", () => {
  it("unit: silence in ⇒ silence out (finite, zero)", () => {
    const proc = new FdnReverbProcessor(FS, 8, makeRng());
    const out = new Float32Array(2048);
    proc.process(new Float32Array(2048), out, baseParams);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
      expect(out[i]).toBe(0);
    }
  });

  it("unit: impulse response is entirely finite (no NaN/Inf over a long tail)", () => {
    const proc = new FdnReverbProcessor(FS, 8, makeRng());
    const out = impulseResponse(proc, FS * 4, { ...baseParams, decayTime: 2 });
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });

  it("unit: impulse response is bounded (no runaway blow-up over a 4 s tail)", () => {
    const proc = new FdnReverbProcessor(FS, 8, makeRng());
    const out = impulseResponse(proc, FS * 4, { ...baseParams, decayTime: 2 });
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    // A lossless core fed a unit impulse can never produce a sample whose
    // magnitude exceeds a small constant; assert a generous ceiling.
    expect(peak).toBeLessThan(4);
  });

  it("unit: the tail decays — late-window energy is far below early-window energy", () => {
    const proc = new FdnReverbProcessor(FS, 8, makeRng());
    const out = impulseResponse(proc, FS * 3, { ...baseParams, decayTime: 1 });
    const early = energy(out, 0, FS / 2); // first 0.5 s
    const late = energy(out, FS * 2, FS * 3); // 2.0–3.0 s
    expect(late).toBeLessThan(early * 0.1);
  });

  it("property: larger decayTime (T60) ⇒ slower decay (more late-tail energy)", () => {
    // Compare late-window energy across a sweep of T60. Monotone non-decreasing.
    const lateEnergies: number[] = [];
    for (const t60 of [0.3, 0.6, 1.0, 2.0, 4.0]) {
      const proc = new FdnReverbProcessor(FS, 8, makeRng());
      const out = impulseResponse(proc, FS * 5, { ...baseParams, decayTime: t60 });
      lateEnergies.push(energy(out, FS * 2, FS * 3)); // fixed 2-3 s window
    }
    for (let i = 1; i < lateEnergies.length; i++) {
      expect(lateEnergies[i]).toBeGreaterThanOrEqual(lateEnergies[i - 1]);
    }
  });

  it("property: stability sweep — long-tail energy never diverges for any decay/damping", () => {
    // Deterministic range loop (project property-test style). For a sweep of
    // decay and damping, a unit impulse must leave the tail bounded: the
    // last-second energy must be finite and small (lossless core + decay gain
    // < 1 ⇒ poles inside/on unit circle).
    for (const t60 of [0.1, 0.5, 1, 2, 5, 10]) {
      for (const damping of [0, 0.3, 0.7, 1]) {
        for (const n of [4, 8] as const) {
          const proc = new FdnReverbProcessor(FS, n, makeRng());
          const out = impulseResponse(proc, FS * 6, {
            ...baseParams,
            decayTime: t60,
            damping,
          });
          const tailEnergy = energy(out, FS * 5, FS * 6); // last second
          expect(Number.isFinite(tailEnergy)).toBe(true);
          // Energy injected by a unit impulse is 1; a lossless-core-with-decay
          // tail can never accumulate more than the input, let alone diverge.
          expect(tailEnergy).toBeLessThan(10);
        }
      }
    }
  });

  it("property: stronger HF damping ⇒ no MORE total tail energy than no damping (absorption only removes)", () => {
    const proc0 = new FdnReverbProcessor(FS, 8, makeRng(5));
    const out0 = impulseResponse(proc0, FS * 3, { ...baseParams, decayTime: 2, damping: 0 });
    const procD = new FdnReverbProcessor(FS, 8, makeRng(5));
    const outD = impulseResponse(procD, FS * 3, { ...baseParams, decayTime: 2, damping: 0.8 });
    // Damping is a per-pass low-pass with non-increasing gain; it cannot add
    // energy. Late-window energy with damping ≤ late energy without (Jot 1991).
    expect(energy(outD, FS, FS * 3)).toBeLessThanOrEqual(energy(out0, FS, FS * 3) + 1e-6);
  });

  it("unit: mix=0 is fully dry (output equals input impulse, no tail)", () => {
    const proc = new FdnReverbProcessor(FS, 8, makeRng());
    const out = impulseResponse(proc, 2048, { ...baseParams, mix: 0 });
    expect(out[0]).toBeCloseTo(1, 6);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeCloseTo(0, 6);
  });

  it("unit: velvet diffusion is multiplication-free add structure — output stays finite with diffusion on", () => {
    const proc = new FdnReverbProcessor(FS, 8, makeRng());
    const out = impulseResponse(proc, FS, { ...baseParams, decayTime: 1, diffusion: 1 });
    for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i])).toBe(true);
  });

  it("exposes a power-of-two-validated size and an orthonormal feedback matrix", () => {
    const proc = new FdnReverbProcessor(FS, 4, makeRng());
    expect(proc.size).toBe(4);
    expect(proc.feedbackMatrix.length).toBe(16);
    expect(() => new FdnReverbProcessor(FS, 5 as 4)).toThrow();
  });
});
