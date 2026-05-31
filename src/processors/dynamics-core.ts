/*
 * Dynamics processor core — context-free DSP math for a feed-forward dynamic
 * range compressor / limiter / expander / gate.
 *
 * Implements the canonical design from:
 *   D. Giannoulis, M. Massberg, J. D. Reiss,
 *   "Digital Dynamic Range Compressor Design — A Tutorial and Analysis",
 *   J. Audio Eng. Soc., Vol. 60, No. 6, pp. 399-408 (2012).
 *
 * Topology (the paper's recommended best practice, p.399 abstract / pp.404-405):
 *   - feed-forward (side-chain driven from the INPUT),
 *   - gain computer = static dB->dB curve (eqs 2-4),
 *   - level detector placed in the LOG domain AFTER the gain computer
 *     (eq 23): smooth the gain-reduction control signal, not the raw level,
 *   - smooth branching peak detector for the ballistics (eq 16).
 *
 * A SINGLE gain computer, parameterized by threshold T, ratio R and knee W,
 * serves all four behaviours (Giannoulis 2012, p.403; see notes.md
 * "Expander / Gate from the SAME machinery"):
 *   - R > 1            -> compressor (slope 1/R < 1 above T),
 *   - R -> infinity     -> limiter (slope -> 0 above T, eqs 18-19),
 *   - R < 1            -> downward expander (slope > 1 BELOW T),
 *   - extreme R < 1    -> gate (very steep downward expansion below T).
 *
 * This file holds ONLY pure numeric math (operates on plain numbers and
 * Float32Array). It has no AudioWorklet / global dependencies so it can be
 * unit-tested directly (the worklet shell in dynamics.ts delegates to it).
 */

/** Parameters consumed per processing block. All dB values are dBFS. */
export interface DynamicsParams {
  /** Threshold T (dB) — level above which compression starts. */
  threshold: number;
  /** Ratio R — reciprocal of slope above T. >1 compress, ->inf limit, <1 expand. */
  ratio: number;
  /** Knee width W (dB) — soft-knee transition centered on T; 0 = hard knee. */
  knee: number;
  /** Attack time tau_A (s) — gain-decrease time constant. */
  attack: number;
  /** Release time tau_R (s) — gain-recovery time constant. */
  release: number;
  /** Make-up gain M (dB) — constant output boost. */
  makeup: number;
}

/**
 * Smallest linear level we are willing to take a logarithm of. Below this the
 * input is treated as silence (gain-reduction control = 0), avoiding -Infinity
 * dB from log10(0).
 */
const LEVEL_FLOOR = 1e-12;

/**
 * Static gain computer — maps an input level x_G (dB) to an output level
 * y_G (dB) given threshold T, ratio R and knee width W.
 *
 * Hard knee (W = 0), Giannoulis 2012 eq.3:
 *   y_G = x_G                       for x_G <= T
 *   y_G = T + (x_G - T) / R         for x_G >  T
 *
 * Soft knee (W > 0), eq.4 — quadratic interpolation across +/- W/2 around T:
 *   y_G = x_G                                              2(x_G-T) < -W
 *   y_G = x_G + (1/R - 1)(x_G - T + W/2)^2 / (2W)          |2(x_G-T)| <= W
 *   y_G = T + (x_G - T) / R                                2(x_G-T) >  W
 *
 * A limiter is R -> infinity: 1/R -> 0, so above T the curve flattens to y_G = T
 * (eqs 18-19). We handle the infinite/zero-slope case explicitly to avoid
 * division by infinity.
 *
 * Downward EXPANSION (R < 1, Giannoulis 2012 p.403 "for ratios < 1 ... the
 * variable simply becomes smaller than -1"): the slope-altered region is BELOW
 * the threshold rather than above it. With slope 1/R > 1 applied for x_G < T,
 * y_G = T + (x_G - T)/R is more negative than x_G, so quiet signals are pushed
 * further down (increasing dynamic range; an extreme R<1 ratio is a gate).
 * See notes.md "Expander / Gate from the SAME machinery". The compressor branch
 * (R >= 1) and the expander branch (R < 1) are mirror images about T, so one
 * function parameterized by T/R/W serves compressor, limiter, expander and gate.
 */
export function computeStaticGain(xG: number, threshold: number, ratio: number, knee: number): number {
  const slope = ratio === Number.POSITIVE_INFINITY ? 0 : 1 / ratio; // 1/R; limiter -> 0
  const delta = xG - threshold;
  const isExpander = ratio < 1; // R < 1 => downward expansion below T

  if (isExpander) {
    // Downward expander: slope-altered region is BELOW threshold (eqs 2-4
    // mirrored). Soft knee centered on T (eq.4 form, mirrored to the lower
    // side): blend the unity slope (above) into slope 1/R (below).
    if (knee > 0 && Math.abs(2 * delta) <= knee) {
      // eq.4 quadratic interpolation, mirrored about T for the expander.
      // The expander's slope-altered region is BELOW T, so the knee must join
      // the slope line at the LOWER edge (delta = -W/2) and unity at the UPPER
      // edge (delta = +W/2). Anchor the parabola to the upper edge (t = 0 there)
      // and subtract the curvature so y_G meets the slope line below: this
      // yields y_G <= x_G everywhere (never boosts) and C0/C1 continuity at both
      // edges (slope 1/R below, unity above). The MINUS sign is the mirror of
      // the compressor branch's PLUS — same eq.4 form, opposite altered side.
      const t = delta - knee / 2; // 0 at the upper edge (delta = +W/2)
      return xG - (slope - 1) * (t * t) / (2 * knee);
    }
    if (delta >= 0) {
      // x_G >= T (above threshold) — unity for a downward expander.
      return xG;
    }
    // x_G < T (below threshold) — slope 1/R > 1 pushes the level down.
    return threshold + delta * slope;
  }

  // Compressor / limiter (R >= 1): slope-altered region is ABOVE threshold.
  // Soft knee (eq.4 middle branch): 2|x_G - T| <= W.
  if (knee > 0 && Math.abs(2 * delta) <= knee) {
    // eq.4: y_G = x_G + (1/R - 1)(x_G - T + W/2)^2 / (2W)
    const t = delta + knee / 2;
    return xG + (slope - 1) * (t * t) / (2 * knee);
  }

  // Hard knee / outside knee region (eq.3 / eq.4 outer branches).
  if (delta <= 0) {
    // x_G <= T (below threshold) — unity. (eq.3 first case.)
    return xG;
  }
  // x_G > T (above threshold) — slope 1/R. (eq.3 second case; eq.4 upper branch.)
  return threshold + delta * slope;
}

/**
 * Time-constant -> one-pole coefficient mapping, Giannoulis 2012 eq.7:
 *   alpha = exp(-1 / (tau * f_s))
 * tau is the time to reach 1 - 1/e of the final value. For tau > 0, f_s > 0
 * the result lies in (0, 1); larger tau -> alpha closer to 1 (slower).
 */
export function timeConstantToCoefficient(tau: number, sampleRate: number): number {
  if (tau <= 0) return 0; // degenerate: instantaneous response
  return Math.exp(-1 / (tau * sampleRate));
}

/**
 * Stateful feed-forward dynamics processor. One instance owns the ballistics
 * state (the smoothed gain-reduction envelope y_L of the eq.16 detector) and is
 * reused block-to-block so the IIR memory is preserved across process() calls —
 * constructing a fresh instance per block would reset the envelope and produce
 * audible transients (same hazard documented for the b-format upmixer).
 */
export class DynamicsProcessor {
  /**
   * Smoothed gain-reduction control envelope y_L[n-1] (the state of the eq.16
   * smooth branching peak detector). Operates on the gain-reduction signal
   * x_L = x_G - y_G (eq.23), which is 0 (no reduction) when not compressing, so
   * the envelope rests at 0.
   */
  private envelopeDb = 0;

  constructor(private readonly sampleRate: number) {}

  /** Reset the ballistics state (e.g. on a discontinuity). */
  reset(): void {
    this.envelopeDb = 0;
  }

  /**
   * Process one sample, returning the gain-applied output sample.
   *
   * Signal flow (Giannoulis 2012 recommended feed-forward, log-domain detector
   * after the gain computer):
   *   1. x_G = 20 log10 |x|                                  (eq.23 line 1)
   *   2. y_G = gain computer(x_G; T, R, W)                   (eqs 3-4)
   *   3. x_L = x_G - y_G                                     (eq.23 line 2)
   *      — the instantaneous gain-reduction (>= 0 for compression/limiting,
   *        also >= 0 for downward expansion).
   *   4. smooth branching peak detector on x_L               (eq.16)
   *   5. c_dB = -y_L + M                                     (eq.23 line 3, eq.1)
   *   6. y[n] = 10^(c_dB / 20) * x[n]                        (eq.1 linear form)
   *
   * @param alphaAttack  precomputed attack coefficient alpha_A (eq.7)
   * @param alphaRelease precomputed release coefficient alpha_R (eq.7)
   */
  private processSample(
    x: number,
    threshold: number,
    ratio: number,
    knee: number,
    alphaAttack: number,
    alphaRelease: number,
    makeup: number,
  ): number {
    const level = Math.abs(x);

    // eq.23 line 1: x_G = 20 log10 |x|. Floor silence to avoid -Inf dB.
    const xG = level < LEVEL_FLOOR ? 20 * Math.log10(LEVEL_FLOOR) : 20 * Math.log10(level);

    // eqs 3-4: static curve.
    const yG = computeStaticGain(xG, threshold, ratio, knee);

    // eq.23 line 2: gain-reduction control signal (log domain, after the gain
    // computer). x_L >= 0 means "this much reduction is wanted right now".
    const xL = xG - yG;

    // eq.16 smooth branching peak detector — smooth the gain-reduction signal.
    // Attack branch when more reduction is wanted than currently applied;
    // release branch otherwise. The smooth (vs plain) branching form low-passes
    // BOTH branches so there is no discontinuity at the attack<->release switch.
    if (xL > this.envelopeDb) {
      // attack: x_L[n] > y_L[n-1]
      this.envelopeDb = alphaAttack * this.envelopeDb + (1 - alphaAttack) * xL;
    } else {
      // release: x_L[n] <= y_L[n-1]
      this.envelopeDb = alphaRelease * this.envelopeDb + (1 - alphaRelease) * xL;
    }

    // eq.23 line 3 + eq.1 make-up: control voltage c_dB = -y_L + M.
    const controlDb = -this.envelopeDb + makeup;

    // eq.1 linear form: y[n] = c[n] * x[n], with c[n] = 10^(c_dB/20).
    const controlLinear = Math.pow(10, controlDb / 20);
    return controlLinear * x;
  }

  /**
   * Process a block. `input` and `output` may alias (in-place is fine). The
   * attack/release coefficients are computed once per block (k-rate params);
   * the per-sample side-chain runs the eq.16 detector and eq.1 multiply.
   */
  process(input: Float32Array, output: Float32Array, params: DynamicsParams): void {
    // eq.7: tau -> alpha, once per block (k-rate).
    const alphaAttack = timeConstantToCoefficient(params.attack, this.sampleRate);
    const alphaRelease = timeConstantToCoefficient(params.release, this.sampleRate);

    const n = Math.min(input.length, output.length);
    for (let i = 0; i < n; i++) {
      output[i] = this.processSample(
        input[i],
        params.threshold,
        params.ratio,
        params.knee,
        alphaAttack,
        alphaRelease,
        params.makeup,
      );
    }
  }
}
