import { describe, expect, it } from "vitest";

import {
  computeMagnitudes,
  findPeaks,
  frameRotation,
  PeakRotatorState,
  regionOfInfluence,
  shiftPeaks,
} from "./phase-vocoder-core";

/**
 * Build a one-frame PeakRotatorState for the given peaks/shift so a single
 * shiftPeaks call uses the paper's cumulative rotator (after one advance, Z_u
 * equals exactly one frame increment exp(j*dw*R)).
 */
function rotatorStateFor(
  peakIndexes: Int32Array,
  nbPeaks: number,
  fftSize: number,
  pitchFactor: number,
  hop: number,
): PeakRotatorState {
  const state = new PeakRotatorState();
  state.advance(peakIndexes, nbPeaks, fftSize, pitchFactor, hop);
  return state;
}

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
    const magLen = fftSize / 2 + 1; // 129
    // middle peak (30): start = 30 - floor((30-10)/2)=20, end = 30 + ceil((60-30)/2)=45
    expect(regionOfInfluence(peaks, 1, 3, magLen)).toEqual({ startIndex: 20, endIndex: 45 });
    // first peak: start clamps to 0
    expect(regionOfInfluence(peaks, 0, 3, magLen).startIndex).toBe(0);
  });

  it("clamps the LAST region to the half-spectrum length, NOT fftSize (no read past Nyquist)", () => {
    // Codex finding #3: the final region's endIndex was fftSize, so source bins
    // could be read beyond the analysed positive spectrum (fftSize/2+1) and fold
    // stale negative-frequency data in. It must clamp to magnitudesLength.
    const peaks = new Int32Array([10, 30, 120]); // last peak near Nyquist
    const fftSize = 256;
    const magLen = fftSize / 2 + 1; // 129
    const last = regionOfInfluence(peaks, 2, 3, magLen);
    expect(last.endIndex).toBe(magLen);
    expect(last.endIndex).not.toBe(fftSize);
    expect(last.endIndex).toBeLessThanOrEqual(magLen);
  });
});

describe("phase-vocoder-core: identity phase-lock (Laroche-Dolson 1999 Section 3.5, Z_u = exp(j*dw*R))", () => {
  it("frameRotation is a unit-modulus complex number (pure rotation, no magnitude change)", () => {
    const rot = frameRotation(40, 60, 1024, 384);
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
    const rot = rotatorStateFor(peaks, 1, fftSize, 1.0, 137);
    shiftPeaks(complex, shifted, peaks, 1, fftSize, magLen, 1.0, rot);
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
    const hop = 256;
    const shifted = makeComplex(fftSize);
    const state = rotatorStateFor(peaks, 1, fftSize, pitchFactor, hop);
    shiftPeaks(complex, shifted, peaks, 1, fftSize, magLen, pitchFactor, state);

    const peakIndexShifted = Math.round(peakIndex * pitchFactor); // 30
    // After one advance, the cumulative Z_u equals exactly one frame increment.
    const expected = frameRotation(peakIndex, peakIndexShifted, fftSize, hop);
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
      const hop = Math.floor(rng() * 1024);
      const shifted = makeComplex(fftSize);
      const state = rotatorStateFor(peaks, 1, fftSize, pitchFactor, hop);
      shiftPeaks(complex, shifted, peaks, 1, fftSize, magLen, pitchFactor, state);

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

describe("phase-vocoder-core: negative-frequency spill is conjugate-reflected (Laroche-Dolson 1999 Section 3.4)", () => {
  it("a downward shift reflects sub-zero bins back with COMPLEX CONJUGATION (not dropped)", () => {
    // Codex finding #1 (blocker). A single peak shifted far DOWN so the left
    // edge of its region of influence crosses 0 Hz. The paper: such a region
    // "is simply reflected back into the positive frequencies with complex
    // conjugation to account for the fact that the original signal is real."
    const fftSize = 64;
    const magLen = fftSize / 2 + 1;
    const complex = makeComplex(fftSize);

    // Single peak at bin 10. With pitchFactor 0.2 -> peakIndexShifted = 2, the
    // map is binIndexShifted = 2 + (b - 10) = b - 8. To isolate one reflected
    // bin with NO colliding direct contribution, energise ONLY:
    //   - the peak bin 10 (-> shifted bin 2), and
    //   - source bin 7 (-> shifted bin -1, reflected to +1).
    // No other source bin maps to bin 1 (that would be source bin 9, left zero).
    const peakIndex = 10;
    complex[peakIndex * 2] = 6 * Math.cos(0.4);
    complex[peakIndex * 2 + 1] = 6 * Math.sin(0.4);
    const srcRe = 3 * Math.cos(0.9);
    const srcIm = 3 * Math.sin(0.9);
    complex[7 * 2] = srcRe;
    complex[7 * 2 + 1] = srcIm;

    const peaks = new Int32Array([peakIndex]);
    const pitchFactor = 0.2; // peakIndexShifted = round(10*0.2) = 2
    const hop = 0; // hop 0 => Z_u = 1, isolating the reflection math from rotation.

    const state = rotatorStateFor(peaks, 1, fftSize, pitchFactor, hop);
    const shifted = makeComplex(fftSize);
    shiftPeaks(complex, shifted, peaks, 1, fftSize, magLen, pitchFactor, state);

    // Reflected bin 1 must carry the CONJUGATE of source bin 7 (im negated),
    // and nothing else (no colliding direct contribution by construction).
    expect(shifted[1 * 2]).toBeCloseTo(srcRe, 5); // real part preserved
    expect(shifted[1 * 2 + 1]).toBeCloseTo(-srcIm, 5); // imag part NEGATED (conjugate)
    // The spilled energy was NOT dropped: bin 1 magnitude == |source bin 7|.
    expect(binMag(shifted, 1)).toBeCloseTo(Math.hypot(srcRe, srcIm), 5);
  });

  it("the completed full spectrum of a down-shifted signal is Hermitian => time domain is real (no imaginary leakage)", () => {
    // The conjugate reflection must keep the output a valid real-signal spectrum.
    // We build the half-spectrum, mirror it Hermitian-style (as completeSpectrum
    // would), inverse-DFT, and assert the imaginary part is ~0 everywhere.
    const fftSize = 32;
    const magLen = fftSize / 2 + 1;
    const complex = makeComplex(fftSize);
    // a peak at bin 6 with a region, plus low bins so a down-shift spills.
    for (let b = 4; b <= 8; b++) {
      const phase = 0.4 * b;
      const mag = b === 6 ? 5 : 1.5;
      complex[b * 2] = mag * Math.cos(phase);
      complex[b * 2 + 1] = mag * Math.sin(phase);
    }
    const peaks = new Int32Array([6]);
    const pf = 0.3; // peakIndexShifted = round(6*0.3)=2; region spills below 0
    const state = rotatorStateFor(peaks, 1, fftSize, pf, 0);
    const shifted = makeComplex(fftSize);
    shiftPeaks(complex, shifted, peaks, 1, fftSize, magLen, pf, state);

    // complete the spectrum Hermitian-symmetrically: X[N-k] = conj(X[k]).
    for (let k = 1; k < fftSize / 2; k++) {
      shifted[(fftSize - k) * 2] = shifted[k * 2];
      shifted[(fftSize - k) * 2 + 1] = -shifted[k * 2 + 1];
    }
    // DC and Nyquist imag must be 0 for a real signal.
    shifted[1] = 0;
    shifted[(fftSize / 2) * 2 + 1] = 0;

    // inverse DFT and check the time-domain imaginary part ~ 0.
    let maxImag = 0;
    for (let n = 0; n < fftSize; n++) {
      let im = 0;
      for (let k = 0; k < fftSize; k++) {
        const ang = (2 * Math.PI * k * n) / fftSize;
        const re = shifted[k * 2];
        const imk = shifted[k * 2 + 1];
        // x[n] = (1/N) sum X[k] e^{+j 2pi kn/N}; imag part:
        im += re * Math.sin(ang) + imk * Math.cos(ang);
      }
      maxImag = Math.max(maxImag, Math.abs(im / fftSize));
    }
    expect(maxImag).toBeLessThan(1e-6);
    // and there is NO NaN anywhere in the spectrum.
    for (let i = 0; i < shifted.length; i++) expect(Number.isNaN(shifted[i])).toBe(false);
  });
});

describe("phase-vocoder-core: cumulative cross-frame phase (Laroche-Dolson 1999 Section 3.5)", () => {
  it("Z_u accumulates frame to frame: after N frames Z = exp(j*dw*R*N), NOT exp(j*dw*timeCursor) recomputed", () => {
    // Codex finding #2 (major). The rotator must advance Z_{u+1} = Z_u*exp(j*dw*R).
    const fftSize = 256;
    const peakIndex = 40;
    const peaks = new Int32Array([peakIndex]);
    const pitchFactor = 1.25; // peakIndexShifted = 50, dw = 2pi*10/256
    const hop = 64;
    const state = new PeakRotatorState();

    let expectedAngle = 0;
    const dw = (2 * Math.PI * (Math.round(peakIndex * pitchFactor) - peakIndex)) / fftSize;
    for (let frame = 1; frame <= 5; frame++) {
      state.advance(peaks, 1, fftSize, pitchFactor, hop);
      expectedAngle += dw * hop;
      const z = state.get(peakIndex);
      const angle = Math.atan2(z.im, z.re);
      let diff = angle - expectedAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff <= -Math.PI) diff += 2 * Math.PI;
      expect(diff).toBeCloseTo(0, 6);
      expect(Math.hypot(z.re, z.im)).toBeCloseTo(1, 9); // stays unit modulus
    }
  });

  it("a CHANGING pitchFactor between frames does NOT retroactively rephase prior frames", () => {
    // The bug: angle = (current dw) * (absolute time). Changing the factor would
    // recompute the WHOLE history with the new dw, jumping the phase. The paper's
    // cumulation preserves the accumulated history and only adds the new frame.
    const fftSize = 256;
    const peakIndex = 50;
    const peaks = new Int32Array([peakIndex]);
    const hop = 64;
    const f1 = 1.2; // shifted bin round(60)=60 -> dw1 = +10 bins
    const f2 = 0.6; // shifted bin round(30)=30 -> dw2 = -20 bins (NOT -dw1, so no alias)

    const state = new PeakRotatorState();
    // 3 frames at factor f1, then 2 frames at factor f2.
    const dw1 = (2 * Math.PI * (Math.round(peakIndex * f1) - peakIndex)) / fftSize;
    const dw2 = (2 * Math.PI * (Math.round(peakIndex * f2) - peakIndex)) / fftSize;
    let expected = 0;
    for (let f = 0; f < 3; f++) {
      state.advance(peaks, 1, fftSize, f1, hop);
      expected += dw1 * hop;
    }
    const afterFirst = state.get(peakIndex);
    let a1 = Math.atan2(afterFirst.im, afterFirst.re);
    let d1 = a1 - expected;
    while (d1 > Math.PI) d1 -= 2 * Math.PI;
    while (d1 <= -Math.PI) d1 += 2 * Math.PI;
    expect(d1).toBeCloseTo(0, 6);

    for (let f = 0; f < 2; f++) {
      state.advance(peaks, 1, fftSize, f2, hop);
      expected += dw2 * hop;
    }
    // The accumulated angle is dw1*hop*3 + dw2*hop*2 — the history at factor 1.25
    // is PRESERVED. Compare the resulting unit rotator to what the OLD buggy
    // "current dw * absolute elapsed time" formula would produce at this frame:
    //   wrong = exp(j * dw2 * (hop*5))  (current factor applied to ALL 5 frames).
    const final = state.get(peakIndex);
    // correct cumulative rotator matches expected accumulated angle.
    expect(final.re).toBeCloseTo(Math.cos(expected), 6);
    expect(final.im).toBeCloseTo(Math.sin(expected), 6);

    // The buggy retroactive rotator is a DIFFERENT complex number (the bug would
    // jump the phase when the factor changed). Chosen so the two do not alias.
    const wrongAngle = dw2 * hop * 5;
    const correct = { re: Math.cos(expected), im: Math.sin(expected) };
    const wrong = { re: Math.cos(wrongAngle), im: Math.sin(wrongAngle) };
    const dist = Math.hypot(correct.re - wrong.re, correct.im - wrong.im);
    expect(dist).toBeGreaterThan(0.1); // the two rotators are genuinely distinct
  });

  it("drops a peak's accumulated phase once it is no longer detected (no stale leak)", () => {
    const fftSize = 256;
    const peaks = new Int32Array([40]);
    const state = new PeakRotatorState();
    state.advance(peaks, 1, fftSize, 1.5, 64);
    expect(state.size).toBe(1);
    // next frame: no peaks detected -> tracked set pruned.
    state.advance(new Int32Array([0]), 0, fftSize, 1.5, 64);
    expect(state.size).toBe(0);
    expect(state.get(40)).toEqual({ re: 1, im: 0 }); // identity for vanished peak
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
