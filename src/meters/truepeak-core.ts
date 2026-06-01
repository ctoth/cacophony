/**
 * ITU-R BS.1770-5 true-peak metering — context-free DSP core.
 *
 * Implements the inter-sample (true-peak) level estimator of Recommendation
 * ITU-R BS.1770-5 (11/2023), Annex 2 (p.18-19). The true peak of a signal is
 * the maximum absolute value of the reconstructed CONTINUOUS-time waveform,
 * which can exceed the largest discrete sample — a peak-sample meter misses it.
 *
 * Per-channel processing stages (Annex 2, Fig. p.18):
 *   1. Attenuate by 12.04 dB (a 2-bit right shift; integer headroom). SKIPPED
 *      here — this is a floating-point implementation, and the recommendation
 *      states the attenuate/restore pair is for integer arithmetic only (p.18).
 *   2. ≥4× over-sample (48 kHz → 192 kHz). A compliant meter must oversample to
 *      at least 192 kHz (p.18-19). This core does 4× via the polyphase FIR.
 *   3. Low-pass interpolation filter — the 48-tap, 4-phase polyphase FIR whose
 *      coefficients are given verbatim below (Annex 2, p.18-19).
 *   4. Take the absolute value (rectify).
 *   5. Convert to dB TP: 20·log10(value) [then +12.04 dB to undo stage 1, which
 *      is a no-op here since stage 1 is skipped].
 *
 * Pure: operates on `Float32Array` and has no Web Audio / worklet dependencies.
 *
 * @see https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
 */

/**
 * The 4× oversampling interpolation FIR of ITU-R BS.1770-5 Annex 2 (p.18-19):
 * order-48, given as a 4-phase polyphase filter (each phase a 12-tap subfilter,
 * 4 × 12 = 48 taps). VERBATIM coefficients. The phases are mirror-symmetric
 * (phase 3 = phase 0 reversed, phase 2 = phase 1 reversed) — the standard
 * linear-phase polyphase structure.
 *
 * Phase k produces the oversampled output sample at fractional position k/4
 * between input samples (phase 0 ≈ the input sample itself).
 */
export const TRUE_PEAK_POLYPHASE_FIR_48K: ReadonlyArray<ReadonlyArray<number>> = [
  // Phase 0 (tap0..tap11)
  [
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625, 0.97216796875,
    -0.102294921875, 0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125,
  ],
  // Phase 1 (tap0..tap11)
  [
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625, 0.77978515625,
    -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375,
  ],
  // Phase 2 (tap0..tap11)
  [
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625, 0.465087890625,
    -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
  ],
  // Phase 3 (tap0..tap11)
  [
    -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875, 0.1373291015625,
    -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375,
  ],
];

/** Oversampling ratio of the verbatim Annex 2 FIR (4×). */
export const TRUE_PEAK_OVERSAMPLE = TRUE_PEAK_POLYPHASE_FIR_48K.length;

const FIR_TAPS = TRUE_PEAK_POLYPHASE_FIR_48K[0].length;
const FINITE_SIGNAL_FLUSH_SAMPLES = FIR_TAPS - 1;
const FINITE_SIGNAL_FLUSH = new Float32Array(FINITE_SIGNAL_FLUSH_SAMPLES);

/**
 * BS.1770-5 Annex 2 requires the oversampled rate to be **at least 192 kHz**
 * (p.18: "The 4× over-sampling filter increases the sampling rate of the signal
 * from 48 kHz to 192 kHz"). The verbatim FIR's 4× only reaches that at ≥48 kHz;
 * at 44.1 kHz, 4× = 176.4 kHz, BELOW the requirement.
 */
export const TRUE_PEAK_MIN_OVERSAMPLED_RATE = 192_000;

/**
 * Chooses the integer oversampling factor for a given input sample rate so the
 * oversampled rate reaches BS.1770-5's ≥192 kHz requirement (Annex 2, p.18). The
 * factor is never below 4 (the verbatim FIR's design ratio), and at sample rates
 * the verbatim 4× already covers (≥48 kHz) it stays 4. Examples: 48 kHz → 4×
 * (192 kHz); 44.1 kHz → 5× (220.5 kHz); 96 kHz → 4× (the spec notes 2× would
 * suffice, but the verbatim FIR floor of 4× is kept as the conservative default).
 */
export function truePeakOversampleFactor(sampleRate: number): number {
  if (!(sampleRate > 0)) {
    return TRUE_PEAK_OVERSAMPLE;
  }
  return Math.max(TRUE_PEAK_OVERSAMPLE, Math.ceil(TRUE_PEAK_MIN_OVERSAMPLED_RATE / sampleRate));
}

/**
 * Builds an N-phase polyphase interpolating FIR (each phase a 12-tap subfilter,
 * matching the verbatim filter's order) from a Hann-windowed-sinc prototype. The
 * BS.1770-5 verbatim coefficients are "one set ... that would satisfy the
 * requirements" (Annex 2, p.18) for the 4× case; for sample rates that need a
 * higher factor to clear 192 kHz, an equivalent windowed-sinc low-pass
 * interpolator of the same order is generated here. Phase k samples the
 * continuous-time reconstruction at fractional offset k/N between input samples.
 */
function buildPolyphaseFir(oversample: number): ReadonlyArray<ReadonlyArray<number>> {
  if (oversample === TRUE_PEAK_OVERSAMPLE) {
    return TRUE_PEAK_POLYPHASE_FIR_48K;
  }
  const taps = FIR_TAPS;
  const center = (taps - 1) / 2; // symmetric about the middle tap
  const phases: number[][] = [];
  for (let phase = 0; phase < oversample; phase++) {
    const frac = phase / oversample; // fractional sample position 0 ≤ frac < 1
    const coeffs: number[] = new Array(taps);
    for (let k = 0; k < taps; k++) {
      // Ideal interpolation kernel sampled at distance (k - center - frac):
      const t = k - center - frac;
      const sincArg = Math.PI * t;
      const sinc = t === 0 ? 1 : Math.sin(sincArg) / sincArg;
      // Hann window across the tap span keeps the FIR finite & low-ripple.
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1));
      coeffs[k] = sinc * w;
    }
    // Normalize each phase to unity DC gain so a constant reconstructs exactly.
    let sum = 0;
    for (const c of coeffs) {
      sum += c;
    }
    if (sum !== 0) {
      for (let k = 0; k < taps; k++) {
        coeffs[k] /= sum;
      }
    }
    phases.push(coeffs);
  }
  return phases;
}

/**
 * Streaming 4× polyphase true-peak detector for ONE channel (ITU-R BS.1770-5
 * Annex 2). Maintains a 12-sample input history so successive blocks join
 * seamlessly, runs every phase of the polyphase FIR per input sample (giving
 * the 4× oversampled stream), rectifies, and tracks the running max.
 *
 * The verbatim coefficients are quoted at 48 kHz. At higher input rates fewer
 * oversampling phases are needed for the same accuracy (Annex 2: 96 kHz → 2×
 * suffices); this 4× design is the conservative default at any rate.
 */
export class TruePeakDetector {
  private readonly history: Float32Array;
  private writeIndex = 0;
  private peak = 0;
  /** The polyphase FIR actually used (verbatim at 4×, generated for >4×). */
  readonly fir: ReadonlyArray<ReadonlyArray<number>>;
  /** Oversampling factor chosen for the input sample rate (≥4; ≥192 kHz). */
  readonly oversample: number;

  /**
   * @param sampleRate Input sample rate in Hz. Selects the oversampling factor
   *   so the oversampled rate reaches BS.1770-5's ≥192 kHz requirement (Annex 2,
   *   p.18). Defaults to 48 kHz (the rate the verbatim FIR is quoted at → 4×).
   */
  constructor(sampleRate: number = 48_000) {
    this.oversample = truePeakOversampleFactor(sampleRate);
    this.fir = buildPolyphaseFir(this.oversample);
    this.history = new Float32Array(FIR_TAPS);
  }

  /**
   * Pushes a block of input samples through the polyphase interpolator and
   * updates the running true peak (max absolute oversampled value).
   */
  process(samples: Float32Array): void {
    for (let n = 0; n < samples.length; n++) {
      // Shift the newest sample into the circular history.
      this.history[this.writeIndex] = samples[n];
      this.writeIndex = (this.writeIndex + 1) % FIR_TAPS;

      // For each polyphase branch, convolve the 12-tap history. tap 0 is the
      // oldest sample; the newest sample is at (writeIndex - 1).
      for (let phase = 0; phase < this.fir.length; phase++) {
        const coeffs = this.fir[phase];
        let acc = 0;
        for (let k = 0; k < FIR_TAPS; k++) {
          const idx = (this.writeIndex + k) % FIR_TAPS;
          acc += coeffs[k] * this.history[idx];
        }
        const mag = Math.abs(acc);
        if (mag > this.peak) {
          this.peak = mag;
        }
      }
    }
  }

  /** Linear (not dB) true-peak magnitude observed so far. */
  truePeak(): number {
    return this.peak;
  }

  /**
   * True-peak level in dBTP (ITU-R BS.1770-5 Annex 2 stage 5: 20·log10 of the
   * rectified oversampled peak, relative to 100% full scale). Returns -Infinity
   * for pure silence.
   */
  truePeakDb(): number {
    return this.peak > 0 ? 20 * Math.log10(this.peak) : -Infinity;
  }

  reset(): void {
    this.history.fill(0);
    this.writeIndex = 0;
    this.peak = 0;
  }
}

/**
 * One-shot true-peak level in dBTP for a single channel signal — ITU-R
 * BS.1770-5 Annex 2. Convenience wrapper over {@link TruePeakDetector} for
 * callers that process a whole signal in one call.
 */
export function truePeakDbForChannel(samples: Float32Array, sampleRate = 48_000): number {
  const detector = new TruePeakDetector(sampleRate);
  detector.process(samples);
  // One-shot finite buffers must drain the FIR history. Without the zero tail,
  // a final-sample peak only reaches the small tail coefficients before return.
  detector.process(FINITE_SIGNAL_FLUSH);
  return detector.truePeakDb();
}

/**
 * True-peak level in dBTP across multiple channels — the maximum per-channel
 * true peak (a programme's true-peak level is the loudest channel; Annex 2 is
 * defined per single channel).
 */
export function truePeakDb(channels: Float32Array[], sampleRate = 48_000): number {
  let maxLinear = 0;
  for (const samples of channels) {
    const detector = new TruePeakDetector(sampleRate);
    detector.process(samples);
    detector.process(FINITE_SIGNAL_FLUSH);
    const tp = detector.truePeak();
    if (tp > maxLinear) {
      maxLinear = tp;
    }
  }
  return maxLinear > 0 ? 20 * Math.log10(maxLinear) : -Infinity;
}
