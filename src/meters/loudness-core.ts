/**
 * ITU-R BS.1770-5 loudness metering — context-free DSP core.
 *
 * Implements the loudness measurement pipeline of Recommendation
 * ITU-R BS.1770-5 (11/2023), "Algorithms to measure audio programme loudness
 * and true-peak audio level", Annex 1:
 *
 *   1. "K" frequency weighting — a two-stage pre-filter per channel
 *      (Annex 1, §2 / Figs 2-4; coefficients Tables 1 & 2, p.4-5).
 *   2. Mean-square per channel z_i (Annex 1, eq.1, p.5).
 *   3. Channel-weighted summation with weights G_i (Annex 1, Table 3, p.7;
 *      L/R/C = 1.0, Ls/Rs = 1.41, LFE excluded).
 *   4. Loudness  L_K = -0.691 + 10·log10(Σ G_i·z_i)  (Annex 1, eq.2, p.6),
 *      and gated integrated loudness via the two-stage gate
 *      (Γ_a = -70 LKFS absolute, Γ_r = -10 LU relative; Annex 1, eq.3-7, p.6-7).
 *
 * Momentary (400 ms) and short-term (3 s) windows are the EBU R128 / Tech 3341
 * ungated derivatives built directly on the same K-weighted mean-square; LRA
 * (loudness range) follows EBU Tech 3342 (95th − 10th percentile of short-term
 * loudness above a relative gate).
 *
 * This module is PURE: it operates on `Float32Array` channel data and has no
 * Web Audio / worklet / global dependencies, so the metering MATH can be unit
 * tested directly (the standardized-audio-context mock carries no signal — its
 * AnalyserNode is an empty stub). Mirrors the context-free-core test pattern of
 * `src/processors/stereo-to-bformat-core.ts`.
 *
 * @see https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
 */

/**
 * BS.1770-5 channel labels for the 3/2 (≤5 main channel) configuration of
 * Annex 1. `LFE` is accepted but EXCLUDED from the loudness sum per the
 * recommendation (Annex 1, Fig.1 / Table 3, p.3,7).
 */
export type LoudnessChannel = "L" | "R" | "C" | "Ls" | "Rs" | "LFE";

/**
 * Per-channel weighting G_i — ITU-R BS.1770-5 Annex 1, Table 3 (p.7).
 * Front/centre channels are unity; the two surround channels are boosted by
 * +1.5 dB (G = 1.41); the LFE channel is not measured (weight 0 / excluded).
 */
export const CHANNEL_WEIGHTS: Readonly<Record<LoudnessChannel, number>> = {
  L: 1.0,
  R: 1.0,
  C: 1.0,
  Ls: 1.41,
  Rs: 1.41,
  LFE: 0, // excluded — see Table 3, p.7
};

/**
 * The K-weighting calibration constant of ITU-R BS.1770-5 Annex 1, eq.2 (p.6).
 * Chosen so the K-weighting filter's gain at the 997 Hz reference frequency is
 * cancelled, making a 0 dBFS 997 Hz sine on L/C/R read exactly -3.01 LKFS (p.7).
 */
export const LOUDNESS_OFFSET = -0.691;

/** Absolute gating threshold Γ_a, ITU-R BS.1770-5 Annex 1, eq.6 (p.6). */
export const ABSOLUTE_GATE_LKFS = -70;

/** Relative gate offset (LU below the absolute-gated mean), Annex 1 eq.6 (p.6). */
export const RELATIVE_GATE_OFFSET_LU = -10;

/** Gating block length T_g, ITU-R BS.1770-5 Annex 1 (p.6): 400 ms. */
export const GATING_BLOCK_SECONDS = 0.4;

/** Gating block overlap, Annex 1 (p.6): 75% → step = 0.25 → 100 ms hop. */
export const GATING_OVERLAP = 0.75;

/** Momentary window (EBU Tech 3341): 400 ms, ungated. */
export const MOMENTARY_SECONDS = 0.4;

/** Short-term window (EBU Tech 3341): 3 s, ungated. */
export const SHORT_TERM_SECONDS = 3.0;

/**
 * Biquad transfer-function coefficients (Direct Form, a0 normalised to 1):
 *   H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
 */
export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Stage 1 of the K-weighting filter — second-order high-shelf modelling the
 * acoustic effect of the head as a rigid sphere. ITU-R BS.1770-5 Annex 1,
 * Table 1 (p.4). VERBATIM coefficients, specified at a 48 kHz sample rate.
 */
export const K_WEIGHTING_STAGE1_48K: Readonly<BiquadCoefficients> = {
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
  a1: -1.69065929318241,
  a2: 0.73248077421585,
};

/**
 * Stage 2 of the K-weighting filter — second-order RLB high-pass. ITU-R
 * BS.1770-5 Annex 1, Table 2 (p.5). VERBATIM coefficients, at 48 kHz.
 */
export const K_WEIGHTING_STAGE2_48K: Readonly<BiquadCoefficients> = {
  b0: 1.0,
  b1: -2.0,
  b2: 1.0,
  a1: -1.99004745483398,
  a2: 0.99007225036621,
};

/** Sample rate the verbatim Table 1/2 coefficients are specified at (p.5). */
export const REFERENCE_SAMPLE_RATE = 48_000;

/**
 * Direct-Form-II transposed biquad. The K-weighting stages are applied as a
 * cascade of two of these (Annex 1, Figs 3-4). Stateful across `process` calls
 * so a streaming caller can feed successive blocks without resetting IIR memory.
 */
export class Biquad {
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  // Transposed Direct Form II state.
  private z1 = 0;
  private z2 = 0;

  constructor(coeffs: BiquadCoefficients) {
    this.b0 = coeffs.b0;
    this.b1 = coeffs.b1;
    this.b2 = coeffs.b2;
    this.a1 = coeffs.a1;
    this.a2 = coeffs.a2;
  }

  process(input: number): number {
    const output = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * output + this.z2;
    this.z2 = this.b2 * input - this.a2 * output;
    return output;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

/**
 * Re-derives the K-weighting coefficients for a sample rate other than the
 * 48 kHz the Table 1/2 values are quoted at, so the digital filter keeps the
 * SAME frequency response (ITU-R BS.1770-5 Annex 1, p.5: "Other sample rates
 * require recomputed coefficients giving the same frequency response").
 *
 * Method: read the analog prototype poles/zeros back out of the 48 kHz digital
 * coefficients with the INVERSE bilinear transform (matched at the reference
 * rate), then re-apply the bilinear transform at the target rate. At 48 kHz
 * this is the identity and returns the verbatim coefficients unchanged.
 */
export function kWeightingCoefficients(sampleRate: number, reference: BiquadCoefficients): BiquadCoefficients {
  if (sampleRate === REFERENCE_SAMPLE_RATE) {
    return { ...reference };
  }
  // Bilinear transform: s = K·(1 - z^-1)/(1 + z^-1), with K = 2·fs (the factor
  // is absorbed by the analog coefficients, so any consistent K works as long
  // as the same K is used for the inverse and forward transform). Recover the
  // continuous-time biquad (analog b/a in powers of s) from the reference
  // digital coefficients at fs_ref, then re-discretise at the target fs.
  const fsRef = REFERENCE_SAMPLE_RATE;
  const kRef = 2 * fsRef;

  // Digital → analog (inverse bilinear). For
  //   H(z) = (b0 + b1 z^-1 + b2 z^-2)/(1 + a1 z^-1 + a2 z^-2)
  // substitute z^-1 = (p - s)/(p + s) (p = kRef = 2·fs_ref) and multiply
  // numerator and denominator by (p + s)^2, collecting powers of s. The
  // resulting analog num/denom coefficients (B2 s^2 + B1 s + B0) /
  // (A2 s^2 + A1 s + A0) keep CONSISTENT relative scaling between num & denom,
  // which the forward transform below then re-discretises at the target rate.
  const p = kRef;
  const { b0, b1, b2, a1, a2 } = reference;
  // Numerator analog coeffs (B2 s^2 + B1 s + B0):
  const B2 = b0 - b1 + b2;
  const B1 = 2 * (b0 - b2) * p;
  const B0 = (b0 + b1 + b2) * p * p;
  // Denominator analog coeffs (A2 s^2 + A1 s + A0):
  const A2 = 1 - a1 + a2;
  const A1 = 2 * (1 - a2) * p;
  const A0 = (1 + a1 + a2) * p * p;

  // Analog → digital (forward bilinear) at the target rate. s = kT·(1-z^-1)/(1+z^-1).
  const kT = 2 * sampleRate;
  const kT2 = kT * kT;
  // Evaluate numerator/denominator polynomials at s = kT·(1-z^-1)/(1+z^-1) and
  // multiply through by (1+z^-1)^2; collect digital coefficients.
  const nd0 = B2 * kT2 + B1 * kT + B0;
  const nd1 = 2 * (B0 - B2 * kT2);
  const nd2 = B2 * kT2 - B1 * kT + B0;
  const dd0 = A2 * kT2 + A1 * kT + A0;
  const dd1 = 2 * (A0 - A2 * kT2);
  const dd2 = A2 * kT2 - A1 * kT + A0;

  return {
    b0: nd0 / dd0,
    b1: nd1 / dd0,
    b2: nd2 / dd0,
    a1: dd1 / dd0,
    a2: dd2 / dd0,
  };
}

/**
 * The two-stage K-weighting pre-filter for ONE channel (Annex 1, §2). Holds the
 * cascade of the Table 1 high-shelf followed by the Table 2 RLB high-pass and
 * preserves IIR state across blocks.
 */
export class KWeightingFilter {
  private readonly stage1: Biquad;
  private readonly stage2: Biquad;

  constructor(sampleRate: number = REFERENCE_SAMPLE_RATE) {
    this.stage1 = new Biquad(kWeightingCoefficients(sampleRate, K_WEIGHTING_STAGE1_48K));
    this.stage2 = new Biquad(kWeightingCoefficients(sampleRate, K_WEIGHTING_STAGE2_48K));
  }

  /** Apply both K-weighting stages to one sample (Annex 1, Figs 3-4). */
  process(input: number): number {
    return this.stage2.process(this.stage1.process(input));
  }

  reset(): void {
    this.stage1.reset();
    this.stage2.reset();
  }
}

/**
 * Converts a channel-weighted mean-square power sum Σ G_i·z_i to loudness in
 * LKFS via ITU-R BS.1770-5 Annex 1, eq.2 (p.6): L_K = -0.691 + 10·log10(Σ).
 * Returns -Infinity for a non-positive sum (digital silence).
 */
export function powerSumToLoudness(weightedPowerSum: number): number {
  if (weightedPowerSum <= 0) {
    return -Infinity;
  }
  return LOUDNESS_OFFSET + 10 * Math.log10(weightedPowerSum);
}

/** One channel's signal plus its BS.1770-5 channel label (for the weight G_i). */
export interface LoudnessChannelInput {
  channel: LoudnessChannel;
  samples: Float32Array;
}

/**
 * K-weights every channel, then returns each channel's mean-square (z_i) over
 * the whole supplied signal. The mean is taken over the common sample count of
 * all channels (Annex 1, eq.1). Pure: constructs fresh filters, no shared state.
 */
export function kWeightedMeanSquares(
  inputs: LoudnessChannelInput[],
  sampleRate: number = REFERENCE_SAMPLE_RATE,
): { channel: LoudnessChannel; meanSquare: number }[] {
  if (inputs.length === 0) {
    return [];
  }
  const frameCount = inputs.reduce((min, input) => Math.min(min, input.samples.length), Infinity);
  return inputs.map((input) => {
    const filter = new KWeightingFilter(sampleRate);
    let sumSquares = 0;
    for (let i = 0; i < frameCount; i++) {
      const y = filter.process(input.samples[i]);
      sumSquares += y * y;
    }
    return {
      channel: input.channel,
      meanSquare: frameCount > 0 ? sumSquares / frameCount : 0,
    };
  });
}

/**
 * Ungated loudness L_K (LKFS) of a multichannel signal — ITU-R BS.1770-5
 * Annex 1, eqs.1-2 (p.5-6). Each channel is K-weighted, its mean-square z_i is
 * taken, multiplied by its weight G_i (Table 3), summed, and converted with
 * the -0.691 offset. LFE is excluded (its weight is 0).
 *
 * This is the basis of momentary/short-term loudness: call it on a 400 ms or
 * 3 s window respectively.
 */
export function integratedUngatedLoudness(
  inputs: LoudnessChannelInput[],
  sampleRate: number = REFERENCE_SAMPLE_RATE,
): number {
  const meanSquares = kWeightedMeanSquares(inputs, sampleRate);
  let weightedSum = 0;
  for (const { channel, meanSquare } of meanSquares) {
    weightedSum += CHANNEL_WEIGHTS[channel] * meanSquare;
  }
  return powerSumToLoudness(weightedSum);
}

/**
 * Per-channel mean-square for ONE gating block (Annex 1, eq.3). Stored so the
 * gating logic can re-sum channel powers across the surviving block set without
 * re-filtering (eq.5 averages z_ij over the gated set BEFORE the log).
 */
interface GatingBlock {
  /** Mean-square per channel index, aligned to `channels`. */
  channelMeanSquares: number[];
  /** Block loudness l_j (Annex 1, eq.4) — used for the two gates. */
  loudness: number;
}

/**
 * Splits the K-weighted channels into overlapping 400 ms gating blocks
 * (75% overlap → 100 ms hop), computing per-block per-channel mean-square and
 * block loudness l_j (ITU-R BS.1770-5 Annex 1, eqs.3-4, p.6).
 */
function computeGatingBlocks(
  inputs: LoudnessChannelInput[],
  sampleRate: number,
): { channels: LoudnessChannel[]; blocks: GatingBlock[] } {
  const channels = inputs.map((input) => input.channel);
  if (inputs.length === 0) {
    return { channels, blocks: [] };
  }

  // K-weight each channel in full once; gating then windows the weighted signal.
  const frameCount = inputs.reduce((min, input) => Math.min(min, input.samples.length), Infinity);
  const weighted: Float32Array[] = inputs.map((input) => {
    const filter = new KWeightingFilter(sampleRate);
    const out = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      out[i] = filter.process(input.samples[i]);
    }
    return out;
  });

  const blockSize = Math.round(GATING_BLOCK_SECONDS * sampleRate);
  const hop = Math.round(blockSize * (1 - GATING_OVERLAP));
  const blocks: GatingBlock[] = [];
  if (blockSize <= 0 || hop <= 0 || frameCount < blockSize) {
    return { channels, blocks };
  }

  // Incomplete trailing blocks are discarded — the measurement interval must
  // end at the end of a gating block (Annex 1, p.6).
  for (let start = 0; start + blockSize <= frameCount; start += hop) {
    const channelMeanSquares: number[] = [];
    let weightedSum = 0;
    for (let c = 0; c < weighted.length; c++) {
      const w = weighted[c];
      let sumSquares = 0;
      for (let i = start; i < start + blockSize; i++) {
        sumSquares += w[i] * w[i];
      }
      const ms = sumSquares / blockSize;
      channelMeanSquares.push(ms);
      weightedSum += CHANNEL_WEIGHTS[channels[c]] * ms;
    }
    blocks.push({ channelMeanSquares, loudness: powerSumToLoudness(weightedSum) });
  }
  return { channels, blocks };
}

/**
 * Gated INTEGRATED loudness (LKFS) — ITU-R BS.1770-5 Annex 1, eqs.3-7 (p.6-7).
 *
 * Two-stage gate:
 *   1. Absolute: keep blocks with l_j > Γ_a (-70 LKFS).
 *   2. Relative: from the absolute-gated set, compute the mean loudness, set
 *      Γ_r = mean - 10 LU, then keep blocks with l_j > Γ_r (and still > Γ_a).
 * The final loudness averages the per-channel mean-squares over the surviving
 * block set, then applies the loudness formula (eq.5) — averaging in the power
 * domain, NOT averaging the per-block LKFS values.
 *
 * Returns -Infinity if no block survives (e.g. all-silent input).
 */
export function integratedLoudness(inputs: LoudnessChannelInput[], sampleRate: number = REFERENCE_SAMPLE_RATE): number {
  const { channels, blocks } = computeGatingBlocks(inputs, sampleRate);
  if (blocks.length === 0) {
    return -Infinity;
  }

  // Stage 1 — absolute gate Γ_a = -70 LKFS (eq.6).
  const absolutePassed = blocks.filter((b) => b.loudness > ABSOLUTE_GATE_LKFS);
  if (absolutePassed.length === 0) {
    return -Infinity;
  }

  // Relative threshold Γ_r: loudness of the absolute-gated blocks, minus 10 LU
  // (eq.6). The "loudness of the gated set" is itself the power-domain mean
  // through the loudness formula (eq.5 applied to the absolute-gated set).
  const relativeThreshold = gatedLoudnessOfSet(channels, absolutePassed) + RELATIVE_GATE_OFFSET_LU;

  // Stage 2 — relative gate (eq.7): l_j > Γ_r AND l_j > Γ_a.
  const finalSet = absolutePassed.filter((b) => b.loudness > relativeThreshold);
  if (finalSet.length === 0) {
    return -Infinity;
  }
  return gatedLoudnessOfSet(channels, finalSet);
}

/**
 * Power-domain loudness of a block set (ITU-R BS.1770-5 Annex 1, eq.5): average
 * each channel's mean-square z_ij over the set, weight by G_i, sum, then apply
 * the -0.691 + 10log10(·) formula.
 */
function gatedLoudnessOfSet(channels: LoudnessChannel[], set: GatingBlock[]): number {
  let weightedSum = 0;
  for (let c = 0; c < channels.length; c++) {
    let meanOfChannel = 0;
    for (const block of set) {
      meanOfChannel += block.channelMeanSquares[c];
    }
    meanOfChannel /= set.length;
    weightedSum += CHANNEL_WEIGHTS[channels[c]] * meanOfChannel;
  }
  return powerSumToLoudness(weightedSum);
}

/**
 * Loudness Range (LRA) in LU — EBU Tech 3342 (built on the BS.1770 short-term
 * loudness). Computes short-term (3 s) loudness on a sliding 1 s grid, applies
 * an absolute gate (-70 LKFS) and a relative gate (mean of the absolute-gated
 * short-term values − 20 LU), then returns the 95th minus the 10th percentile
 * of the gated short-term loudness distribution.
 *
 * Returns 0 when fewer than two short-term windows survive the gate.
 */
export function loudnessRange(inputs: LoudnessChannelInput[], sampleRate: number = REFERENCE_SAMPLE_RATE): number {
  if (inputs.length === 0) {
    return 0;
  }
  const frameCount = inputs.reduce((min, input) => Math.min(min, input.samples.length), Infinity);
  const weighted: Float32Array[] = inputs.map((input) => {
    const filter = new KWeightingFilter(sampleRate);
    const out = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      out[i] = filter.process(input.samples[i]);
    }
    return out;
  });
  const channels = inputs.map((input) => input.channel);

  const windowSize = Math.round(SHORT_TERM_SECONDS * sampleRate);
  const hop = Math.round(1.0 * sampleRate); // 1 s grid (Tech 3342)
  if (windowSize <= 0 || hop <= 0 || frameCount < windowSize) {
    return 0;
  }

  const shortTerm: number[] = [];
  for (let start = 0; start + windowSize <= frameCount; start += hop) {
    let weightedSum = 0;
    for (let c = 0; c < weighted.length; c++) {
      const w = weighted[c];
      let sumSquares = 0;
      for (let i = start; i < start + windowSize; i++) {
        sumSquares += w[i] * w[i];
      }
      weightedSum += CHANNEL_WEIGHTS[channels[c]] * (sumSquares / windowSize);
    }
    shortTerm.push(powerSumToLoudness(weightedSum));
  }

  // Absolute gate at -70 LKFS (Tech 3342).
  const absolute = shortTerm.filter((l) => l > ABSOLUTE_GATE_LKFS);
  if (absolute.length === 0) {
    return 0;
  }
  // Relative gate: mean (power domain via the loudness identity) − 20 LU.
  const meanAbsolute = meanLoudness(absolute);
  const relativeThreshold = meanAbsolute - 20;
  const gated = absolute.filter((l) => l > relativeThreshold).sort((a, b) => a - b);
  if (gated.length < 2) {
    return 0;
  }
  const p10 = percentile(gated, 10);
  const p95 = percentile(gated, 95);
  return p95 - p10;
}

/** Power-domain mean of a set of LKFS values (inverse of the loudness formula). */
function meanLoudness(values: number[]): number {
  let sumPower = 0;
  for (const l of values) {
    sumPower += 10 ** ((l - LOUDNESS_OFFSET) / 10);
  }
  return powerSumToLoudness(sumPower / values.length);
}

/** Linear-interpolated percentile of a pre-sorted ascending array. */
function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 1) {
    return sortedAscending[0];
  }
  const rank = (p / 100) * (sortedAscending.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sortedAscending[low];
  }
  const frac = rank - low;
  return sortedAscending[low] * (1 - frac) + sortedAscending[high] * frac;
}
