import { describe, expect, it } from "vitest";

import { computeMagnitudes, findPeaks, peakRotator, regionOfInfluence, shiftPeaks } from "./phase-vocoder-core";

/**
 * Tests for the Laroche-Dolson 1999 Identity Phase-Locking pitch-shift core.
 *
 * The load-bearing invariant (Laroche-Dolson 1999 Section 3.5): every bin in a
 * peak's region of influence is rotated by the SAME complex number Z_u, so the
 * intra-region (vertical) phase relationships survive the shift unchanged. The
 * degenerate predecessor rotated each bin by a different angle; these tests pin
 * the corrected behaviour.
 */

/** Build an interleaved [re, im, ...] complex buffer of `fftSize/2+1` usable bins. */
function makeComplex(fftSize: number): Float32Array {
  // fft.js complex arrays are length 2*fftSize (full spectrum); we only touch
  // the first magnitudesLength*2 entries here.
  return new Float32Array(2 * fftSize);
}

/** Magnitude of bin `b` in an interleaved complex buffer. */
function binMag(complex: Float32Array, b: number): number {
  const re = complex[b * 2];
  const im = complex[b * 2 + 1];
  return Math.hypot(re, im);
}

/** Phase (radians) of bin `b` in an interleaved complex buffer. */
function binPhase(complex: Float32Array, b: number): number {
  return Math.atan2(complex[b * 2 + 1], complex[b * 2]);
}

describe("phase-vocoder-core: peak detection (Laroche-Dolson 1999 Section 3.2)", () => {
  it("flags a bin that strictly exceeds its two neighbours on each side", () => {
    const magnitudes = new Float32Array([0, 0, 1, 2, 9, 2, 1, 0, 0]);
    const peakIndexes = new Int32Array(magnitudes.length);
    const n = findPeaks(magnitudes, peakIndexes);
    expect(n).toBe(1);
    expect(peakIndexes[0]).toBe(4);
  });

  it("does not flag a plateau (neighbour equal disqualifies)", () => {
    const magnitudes = new Float32Array([0, 0, 5, 5, 5, 0, 0]);
    const peakIndexes = new Int32Array(magnitudes.length);
    expect(findPeaks(magnitudes, peakIndexes)).toBe(0);
  });
});

describe("phase-vocoder-core: region of influence (half-way boundaries)", () => {
  it("splits the axis half-way between adjacent peaks", () => {
    const peaks = new Int32Array([10, 30, 60]);
    const fftSize = 256;
    // middle peak (30): start = 30 - floor((30-10)/2)=20, end = 30 + ceil((60-30)/2)=45
    expect(regionOfInfluence(peaks, 1, 3, fftSize)).toEqual({ startIndex: 20, endIndex: 45 });
    // first peak: start clamps to 0
    expect(regionOfInfluence(peaks, 0, 3, fftSize).startIndex).toBe(0);
    // last peak: end clamps to fftSize
    expect(regionOfInfluence(peaks, 2, 3, fftSize).endIndex).toBe(fftSize);
  });
});

describe("phase-vocoder-core: identity phase-lock (Laroche-Dolson 1999 Section 3.5, Z_u = exp(j*dw*R))", () => {
  it("peakRotator is a unit-modulus complex number (pure rotation, no magnitude change)", () => {
    const rot = peakRotator(40, 60, 1024, 384);
    expect(Math.hypot(rot.re, rot.im)).toBeCloseTo(1, 12);
  });

  it("with no shift (pitchFactor=1) the rotation is identity — output equals input on the peak region", () => {
    // Laroche-Dolson 1999 testable property: Delta-omega = 0 reduces to identity.
    const fftSize = 64;
    const magLen = fftSize / 2 + 1;
    const complex = makeComplex(fftSize);
    // a peak at bin 16 with a few skirt bins carrying distinct phases
    for (let b = 14; b <= 18; b++) {
      const phase = 0.3 * b; // arbitrary distinct per-bin phases
      const mag = b === 16 ? 4 : 1;
      complex[b * 2] = mag * Math.cos(phase);
      complex[b * 2 + 1] = mag * Math.sin(phase);
    }
    const peaks = new Int32Array([16]);
    const shifted = makeComplex(fftSize);
    shiftPeaks(complex, shifted, peaks, 1, fftSize, magLen, 1.0, 137);
    for (let b = 14; b <= 18; b++) {
      expect(binMag(shifted, b)).toBeCloseTo(binMag(complex, b), 6);
      expect(binPhase(shifted, b)).toBeCloseTo(binPhase(complex, b), 6);
    }
  });

  it("every bin in a peak's region receives the SAME rotation angle (the identity-lock invariant)", () => {
    const fftSize = 128;
    const magLen = fftSize / 2 + 1;
    const complex = makeComplex(fftSize);

    // Single peak at bin 20 with a 5-bin region carrying DISTINCT input phases.
    const peakIndex = 20;
    const inputPhases: Record<number, number> = {};
    for (let b = 18; b <= 22; b++) {
      const phase = 0.137 * (b + 1); // distinct, non-trivial per-bin phase
      const mag = b === peakIndex ? 5 : 1.5;
      inputPhases[b] = phase;
      complex[b * 2] = mag * Math.cos(phase);
      complex[b * 2 + 1] = mag * Math.sin(phase);
    }

    const peaks = new Int32Array([peakIndex]);
    const pitchFactor = 1.5;
    const timeCursor = 256;
    const shifted = makeComplex(fftSize);
    shiftPeaks(complex, shifted, peaks, 1, fftSize, magLen, pitchFactor, timeCursor);

    const peakIndexShifted = Math.round(peakIndex * pitchFactor); // 30
    const expected = peakRotator(peakIndex, peakIndexShifted, fftSize, timeCursor);
    const expectedAngle = Math.atan2(expected.im, expected.re);

    // For each source bin in the region, the shifted bin's phase must equal the
    // input phase PLUS the single per-peak rotation angle — the SAME angle for
    // every bin. We recover the applied rotation per bin and assert it is
    // identical across the whole region.
    const appliedRotations: number[] = [];
    for (let b = 18; b <= 22; b++) {
      const bShifted = peakIndexShifted + (b - peakIndex);
      const applied = binPhase(shifted, bShifted) - inputPhases[b];
      // normalise to (-pi, pi]
      let d = applied;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d <= -Math.PI) d += 2 * Math.PI;
      appliedRotations.push(d);
      // magnitude is preserved (pure rotation)
      expect(binMag(shifted, bShifted)).toBeCloseTo(binMag(complex, b), 6);
    }

    // INVARIANT 1: all applied rotations equal the single per-peak angle.
    for (const r of appliedRotations) {
      let diff = r - expectedAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff <= -Math.PI) diff += 2 * Math.PI;
      expect(diff).toBeCloseTo(0, 6);
    }

    // INVARIANT 2: inter-bin phase relationships preserved. The phase
    // DIFFERENCE between adjacent shifted bins equals the input phase
    // difference (rotation cancels in the difference).
    for (let b = 18; b < 22; b++) {
      const inDiff = inputPhases[b + 1] - inputPhases[b];
      const sA = peakIndexShifted + (b - peakIndex);
      const sB = peakIndexShifted + (b + 1 - peakIndex);
      let outDiff = binPhase(shifted, sB) - binPhase(shifted, sA);
      let normIn = inDiff;
      while (outDiff > Math.PI) outDiff -= 2 * Math.PI;
      while (outDiff <= -Math.PI) outDiff += 2 * Math.PI;
      while (normIn > Math.PI) normIn -= 2 * Math.PI;
      while (normIn <= -Math.PI) normIn += 2 * Math.PI;
      expect(outDiff).toBeCloseTo(normIn, 6);
    }
  });

  it("property: across many random regions and shifts, intra-region phase deltas are invariant under the shift", () => {
    const fftSize = 256;
    const magLen = fftSize / 2 + 1;
    // deterministic LCG so the property test is reproducible
    let seed = 0x9e3779b1;
    const rng = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let trial = 0; trial < 50; trial++) {
      const complex = makeComplex(fftSize);
      const peakIndex = 20 + Math.floor(rng() * 40); // 20..59
      const half = 1 + Math.floor(rng() * 4); // region half-width 1..4
      const phases: Record<number, number> = {};
      for (let b = peakIndex - half; b <= peakIndex + half; b++) {
        const phase = (rng() * 2 - 1) * Math.PI;
        const mag = b === peakIndex ? 3 + rng() * 5 : 0.5 + rng();
        phases[b] = phase;
        complex[b * 2] = mag * Math.cos(phase);
        complex[b * 2 + 1] = mag * Math.sin(phase);
      }
      const peaks = new Int32Array([peakIndex]);
      const pitchFactor = 0.6 + rng() * 1.3; // 0.6..1.9
      const timeCursor = Math.floor(rng() * 1024);
      const shifted = makeComplex(fftSize);
      shiftPeaks(complex, shifted, peaks, 1, fftSize, magLen, pitchFactor, timeCursor);

      const peakIndexShifted = Math.round(peakIndex * pitchFactor);
      if (peakIndexShifted + half >= magLen || peakIndexShifted - half < 0) {
        continue; // region spilled out of the half-spectrum; skip (not the invariant under test)
      }

      for (let b = peakIndex - half; b < peakIndex + half; b++) {
        const inDiff = phases[b + 1] - phases[b];
        const sA = peakIndexShifted + (b - peakIndex);
        const sB = peakIndexShifted + (b + 1 - peakIndex);
        let outDiff = binPhase(shifted, sB) - binPhase(shifted, sA);
        let normIn = inDiff;
        while (outDiff > Math.PI) outDiff -= 2 * Math.PI;
        while (outDiff <= -Math.PI) outDiff += 2 * Math.PI;
        while (normIn > Math.PI) normIn -= 2 * Math.PI;
        while (normIn <= -Math.PI) normIn += 2 * Math.PI;
        expect(outDiff).toBeCloseTo(normIn, 5);
      }
    }
  });
});

describe("phase-vocoder-core: computeMagnitudes", () => {
  it("computes squared magnitude per bin from interleaved complex", () => {
    const complex = new Float32Array([3, 4, 0, 0, 1, 0]); // |3+4i|^2=25, 0, 1
    const out = new Float32Array(3);
    computeMagnitudes(complex, out);
    expect(Array.from(out)).toEqual([25, 0, 1]);
  });
});
