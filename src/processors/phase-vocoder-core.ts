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

/**
 * The single complex rotator Z_u = exp(j * Delta-omega * R) for one peak,
 * accumulated to frame index R*frame = `timeCursor` samples of elapsed
 * synthesis time. Laroche-Dolson 1999 eq. p.3.
 *
 * Delta-omega (rad/sample) is the frequency shift the peak undergoes:
 *   Delta-omega = 2*pi * (peakIndexShifted - peakIndex) / fftSize.
 * Multiplying by the elapsed sample count `timeCursor` (= cumulated hop R over
 * frames) realises the frame-to-frame cumulation Z_{u+1} = Z_u * exp(...).
 *
 * Returns the SAME rotator for the whole region of influence — the caller must
 * apply it identically to every bin in the region (that uniformity is the
 * Identity Phase-Lock invariant).
 */
export function peakRotator(
  peakIndex: number,
  peakIndexShifted: number,
  fftSize: number,
  timeCursor: number,
): { re: number; im: number } {
  const omegaDelta = (2 * Math.PI * (peakIndexShifted - peakIndex)) / fftSize;
  const angle = omegaDelta * timeCursor;
  return { re: Math.cos(angle), im: Math.sin(angle) };
}

/**
 * Half-way region-of-influence boundaries for peak `i` (Laroche-Dolson 1999
 * Section 3.2 — boundary set midway between adjacent peaks). Returns the
 * [startIndex, endIndex) bin range owned by this peak.
 */
export function regionOfInfluence(
  peakIndexes: Int32Array,
  i: number,
  nbPeaks: number,
  fftSize: number,
): { startIndex: number; endIndex: number } {
  const peakIndex = peakIndexes[i];
  const startIndex = i > 0 ? peakIndex - Math.floor((peakIndex - peakIndexes[i - 1]) / 2) : 0;
  const endIndex = i < nbPeaks - 1 ? peakIndex + Math.ceil((peakIndexes[i + 1] - peakIndex) / 2) : fftSize;
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
  timeCursor: number,
): void {
  shifted.fill(0);

  for (let i = 0; i < nbPeaks; i++) {
    const peakIndex = peakIndexes[i];
    const peakIndexShifted = Math.round(peakIndex * pitchFactor);

    if (peakIndexShifted > magnitudesLength) {
      break;
    }

    const { startIndex, endIndex } = regionOfInfluence(peakIndexes, i, nbPeaks, fftSize);

    // Laroche-Dolson 1999 Identity Phase-Locking: ONE rotation per peak,
    // applied uniformly to the whole region of influence. Computed once here
    // (one cosine + one sine per peak, as the paper specifies) rather than
    // recomputed per bin — preserving the intra-region phase relationships.
    const rot = peakRotator(peakIndex, peakIndexShifted, fftSize, timeCursor);

    for (let j = startIndex - peakIndex; j < endIndex - peakIndex; j++) {
      const binIndex = peakIndex + j;
      const binIndexShifted = peakIndexShifted + j;

      if (binIndexShifted >= magnitudesLength) {
        break;
      }
      if (binIndex < 0) {
        continue;
      }

      const indexReal = binIndex * 2;
      const indexImag = indexReal + 1;
      const valueReal = complex[indexReal];
      const valueImag = complex[indexImag];

      // Complex multiply by the single per-peak rotator Z_u.
      const valueShiftedReal = valueReal * rot.re - valueImag * rot.im;
      const valueShiftedImag = valueReal * rot.im + valueImag * rot.re;

      const indexShiftedReal = binIndexShifted * 2;
      const indexShiftedImag = indexShiftedReal + 1;
      shifted[indexShiftedReal] += valueShiftedReal;
      shifted[indexShiftedImag] += valueShiftedImag;
    }
  }
}
