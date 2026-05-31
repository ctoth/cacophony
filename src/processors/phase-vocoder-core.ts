/*
 * Phase-vocoder core — context-free, unit-testable DSP for peak-based
 * pitch-shifting with Identity Phase-Locking.
 *
 * Algorithm: Jean Laroche & Mark Dolson, "New Phase-Vocoder Techniques for
 * Pitch-Shifting, Harmonizing and Other Exotic Effects", Proc. 1999 IEEE
 * WASPAA, New Paltz, NY. The pitch-shift detects spectral peaks, divides the
 * frequency axis into per-peak "regions of influence", and rigidly translates
 * each region to the peak's shifted frequency (Section 3.1-3.4).
 *
 * The phase handling is the "Identity Phase-Locking" rule of Laroche-Dolson
 * 1999 Section 3.5: to maintain frame-to-frame (horizontal) phase coherence
 * after shifting a peak by Delta-omega, EVERY frequency bin in that peak's
 * region of influence is multiplied by a SINGLE complex number
 *
 *     Z_u = exp(j * Delta-omega * R)            (Laroche-Dolson 1999, eq. p.3)
 *
 * (R = hop size), and the rotation is cumulated frame to frame
 *
 *     Z_{u+1} = Z_u * exp(j * Delta-omega_{u+1} * R).
 *
 * Because all bins in a region are rotated by the SAME angle, the phase
 * relationships BETWEEN bins around a peak (the vertical / intra-peak
 * coherence that identifies the sinusoid) are PRESERVED across the move — this
 * is exactly what removes the "phasiness" artifact of the naive bin-independent
 * phase vocoder. No knowledge of the true peak frequency omega is needed, so no
 * arctangent and no phase-unwrapping (Laroche-Dolson 1999 Section 3.5).
 *
 * This module mirrors the project's core/shell split (cf. waveshaper-core.ts,
 * dynamics-core.ts): the FFT framing and worklet plumbing live in the
 * AudioWorkletProcessor shell (phase-vocoder.ts); the spectrum manipulation
 * that carries the testable invariants lives here.
 */

/**
 * Squared-magnitude spectrum from an interleaved [re, im, re, im, ...] complex
 * buffer. `magnitudes[i]` corresponds to bin `i`. Writes into `out` (length
 * fftSize/2 + 1) to avoid per-call allocation in the worklet.
 */
export function computeMagnitudes(complex: Float32Array, out: Float32Array): void {
  for (let i = 0, j = 0; i < out.length; i++, j += 2) {
    const real = complex[j];
    const imag = complex[j + 1];
    out[i] = real ** 2 + imag ** 2;
  }
}

/**
 * Peak detection per Laroche-Dolson 1999 Section 3.2: a bin is a peak iff its
 * magnitude strictly exceeds its two nearest neighbours on each side. Writes
 * the peak bin indices into `peakIndexes` and returns the count.
 */
export function findPeaks(magnitudes: Float32Array, peakIndexes: Int32Array): number {
  let nbPeaks = 0;
  for (let i = 2, end = magnitudes.length - 2; i < end; i++) {
    const mag = magnitudes[i];
    if (
      magnitudes[i - 1] >= mag ||
      magnitudes[i - 2] >= mag ||
      magnitudes[i + 1] >= mag ||
      magnitudes[i + 2] >= mag
    ) {
      continue;
    }
    peakIndexes[nbPeaks++] = i;
  }
  return nbPeaks;
}

/** A unit-modulus complex rotator Z = re + j*im. */
export interface Rotator {
  re: number;
  im: number;
}

/**
 * The per-frame phase increment exp(j * Delta-omega * R) for ONE peak shifted
 * by Delta-omega over a hop of R synthesis samples. Laroche-Dolson 1999 eq.
 * p.3 (Section 3.5), the single complex number applied uniformly to the peak's
 * whole region of influence.
 *
 * Delta-omega (rad/sample) is the frequency shift the peak undergoes:
 *   Delta-omega = 2*pi * (peakIndexShifted - peakIndex) / fftSize.
 *
 * This is the per-frame factor, NOT the cumulative rotator. Cross-frame
 * cumulation Z_{u+1} = Z_u * exp(j*Delta-omega_{u+1}*R) is the job of
 * {@link PeakRotatorState}; this function produces the `exp(...)` factor that
 * state multiplies in each frame.
 */
export function frameRotation(peakIndex: number, peakIndexShifted: number, fftSize: number, hop: number): Rotator {
  const omegaDelta = (2 * Math.PI * (peakIndexShifted - peakIndex)) / fftSize;
  const angle = omegaDelta * hop;
  return { re: Math.cos(angle), im: Math.sin(angle) };
}

/**
 * Cross-frame cumulative phase-lock state (Laroche-Dolson 1999 Section 3.5).
 *
 * The paper requires the per-peak rotation be ACCUMULATED frame to frame:
 *
 *     Z_{u+1} = Z_u * exp(j * Delta-omega_{u+1} * R)
 *
 * with Delta-omega allowed to vary per frame (automated / time-varying pitch).
 * A naive `omegaDelta * elapsedTime` rotator is wrong: when the shift changes,
 * it retroactively re-phases every prior frame and produces a discontinuity.
 *
 * This state keeps one cumulative rotator Z_u PER PEAK, keyed by the peak's
 * source bin index. {@link PeakRotatorState.advance} multiplies each peak's Z
 * by this frame's exp(j*Delta-omega*R) (so history is preserved across pitch
 * changes), and {@link PeakRotatorState.get} returns the current cumulative
 * rotator to apply to that peak's region of influence.
 */
export class PeakRotatorState {
  /** peak source-bin index -> cumulative rotator Z_u (unit modulus). */
  private rotators = new Map<number, Rotator>();
  /** scratch set of bins seen this frame, for pruning vanished peaks. */
  private seen = new Set<number>();

  /**
   * Advance every currently-detected peak's cumulative rotator by this frame's
   * exp(j*Delta-omega*R). New peaks start at Z = 1 (no rotation) then take this
   * frame's increment; peaks not present this frame are dropped so their stale
   * phase does not leak into a later re-detection.
   *
   * `pitchFactor` and `hop` define this frame's per-peak Delta-omega via the
   * shifted bin `round(peakIndex * pitchFactor)`.
   */
  advance(peakIndexes: Int32Array, nbPeaks: number, fftSize: number, pitchFactor: number, hop: number): void {
    this.seen.clear();
    for (let i = 0; i < nbPeaks; i++) {
      const peakIndex = peakIndexes[i];
      this.seen.add(peakIndex);
      const peakIndexShifted = Math.round(peakIndex * pitchFactor);
      const inc = frameRotation(peakIndex, peakIndexShifted, fftSize, hop);
      const prev = this.rotators.get(peakIndex) ?? { re: 1, im: 0 };
      // Z_{u+1} = Z_u * inc  (complex multiply)
      this.rotators.set(peakIndex, {
        re: prev.re * inc.re - prev.im * inc.im,
        im: prev.re * inc.im + prev.im * inc.re,
      });
    }
    // Prune peaks that disappeared this frame.
    for (const key of this.rotators.keys()) {
      if (!this.seen.has(key)) this.rotators.delete(key);
    }
  }

  /** The current cumulative rotator Z_u for a peak (identity if unseen). */
  get(peakIndex: number): Rotator {
    return this.rotators.get(peakIndex) ?? { re: 1, im: 0 };
  }

  /** Reset all accumulated phase (e.g. on stop / re-seek). */
  reset(): void {
    this.rotators.clear();
    this.seen.clear();
  }

  /** Number of peaks currently tracked (test/introspection helper). */
  get size(): number {
    return this.rotators.size;
  }
}

/**
 * Half-way region-of-influence boundaries for peak `i` (Laroche-Dolson 1999
 * Section 3.2 — boundary set midway between adjacent peaks). Returns the
 * [startIndex, endIndex) bin range owned by this peak.
 *
 * The LAST peak's region must end at the non-redundant half-spectrum length
 * `magnitudesLength` (= fftSize/2 + 1), NOT at `fftSize`. The analysed spectrum
 * only carries bins [0, fftSize/2]; the upper half is the conjugate-symmetric
 * mirror filled later by `completeSpectrum`. Reading source bins past Nyquist
 * folds stale / not-yet-populated negative-frequency data into the output, so
 * the region is clamped to the analysed positive spectrum.
 */
export function regionOfInfluence(
  peakIndexes: Int32Array,
  i: number,
  nbPeaks: number,
  magnitudesLength: number,
): { startIndex: number; endIndex: number } {
  const peakIndex = peakIndexes[i];
  const startIndex = i > 0 ? peakIndex - Math.floor((peakIndex - peakIndexes[i - 1]) / 2) : 0;
  const endIndex = i < nbPeaks - 1 ? peakIndex + Math.ceil((peakIndexes[i + 1] - peakIndex) / 2) : magnitudesLength;
  return { startIndex, endIndex };
}

/**
 * Peak-shift with Identity Phase-Locking (Laroche-Dolson 1999, Sections 3.4 &
 * 3.5). For each detected peak:
 *  - compute the shifted peak bin (peakIndex * pitchFactor, rounded — the
 *    integer-bin case of Section 3.4, a lossless region copy),
 *  - compute ONE rotator Z_u = exp(j*Delta-omega*timeCursor) for the peak
 *    (`peakRotator`),
 *  - rigidly translate the peak's region of influence to the shifted location,
 *    multiplying EVERY bin in the region by that SAME Z_u.
 * Overlapping shifted regions are summed (Section 3.4).
 *
 * `complex` is the analysis spectrum (interleaved re/im). `shifted` is the
 * output spectrum (interleaved re/im) and is zero-filled here before
 * accumulation. `magnitudesLength` = fftSize/2 + 1 (the non-redundant bin
 * count); bins beyond it are skipped / terminate the peak loop, matching the
 * worklet's pre-`completeSpectrum` half-spectrum.
 */
export function shiftPeaks(
  complex: Float32Array,
  shifted: Float32Array,
  peakIndexes: Int32Array,
  nbPeaks: number,
  fftSize: number,
  magnitudesLength: number,
  pitchFactor: number,
  rotators: PeakRotatorState,
): void {
  shifted.fill(0);

  for (let i = 0; i < nbPeaks; i++) {
    const peakIndex = peakIndexes[i];
    const peakIndexShifted = Math.round(peakIndex * pitchFactor);

    const { startIndex, endIndex } = regionOfInfluence(peakIndexes, i, nbPeaks, magnitudesLength);

    // Laroche-Dolson 1999 Identity Phase-Locking: ONE cumulative rotator Z_u
    // per peak, applied uniformly to the whole region of influence (one complex
    // multiply per bin), preserving the intra-region phase relationships. Z_u
    // is accumulated frame-to-frame by PeakRotatorState — not recomputed from
    // absolute time — so a changing pitchFactor does not retroactively rephase.
    const rot = rotators.get(peakIndex);

    for (let j = startIndex - peakIndex; j < endIndex - peakIndex; j++) {
      const binIndex = peakIndex + j;
      const binIndexShifted = peakIndexShifted + j;

      if (binIndexShifted >= magnitudesLength) {
        break;
      }
      // Source bins are only valid inside the analysed positive spectrum.
      if (binIndex < 0 || binIndex >= magnitudesLength) {
        continue;
      }

      const indexReal = binIndex * 2;
      const indexImag = indexReal + 1;
      const valueReal = complex[indexReal];
      const valueImag = complex[indexImag];

      // Complex multiply by the single per-peak cumulative rotator Z_u.
      const valueShiftedReal = valueReal * rot.re - valueImag * rot.im;
      const valueShiftedImag = valueReal * rot.im + valueImag * rot.re;

      if (binIndexShifted < 0) {
        // Laroche-Dolson 1999 Section 3.4: a region of influence spilling onto
        // the NEGATIVE-frequency axis is reflected back into the positive
        // frequencies with COMPLEX CONJUGATION, because the original signal is
        // real (Hermitian symmetry X(-w) = conj(X(w))). Without this the energy
        // below DC is dropped and downward shifts lose their low end.
        const reflected = -binIndexShifted;
        if (reflected >= magnitudesLength) {
          continue;
        }
        const reflReal = reflected * 2;
        const reflImag = reflReal + 1;
        shifted[reflReal] += valueShiftedReal;
        shifted[reflImag] += -valueShiftedImag; // conjugate
        continue;
      }

      const indexShiftedReal = binIndexShifted * 2;
      const indexShiftedImag = indexShiftedReal + 1;
      shifted[indexShiftedReal] += valueShiftedReal;
      shifted[indexShiftedImag] += valueShiftedImag;
    }
  }
}
