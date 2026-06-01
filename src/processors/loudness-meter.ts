/**
 * Loudness metering AudioWorkletProcessor — ITU-R BS.1770-5.
 *
 * A PASS-THROUGH metering tap: it copies its input straight to its output
 * (so inserting it never alters the audible signal) while measuring loudness
 * in real time and posting the latest readings back to the main thread via the
 * MessagePort.
 *
 * The metering MATH lives entirely in the context-free cores
 * `../meters/loudness-core` and `../meters/truepeak-core` (verbatim ITU-R
 * BS.1770-5 coefficients and formulae), which are unit-tested directly on
 * `Float32Array`s — the standardized-audio-context mock cannot carry signal, so
 * the worklet shell here is intentionally thin. Rollup inlines the imported
 * cores into the IIFE worklet bundle.
 *
 * Reported values:
 *   - momentary  (M): K-weighted loudness over the last 400 ms (EBU Tech 3341).
 *   - shortTerm  (S): K-weighted loudness over the last 3 s (EBU Tech 3341).
 *   - integrated (I): gated integrated loudness since the last reset
 *     (ITU-R BS.1770-5 Annex 1 two-stage gate, -70 abs / -10 rel).
 *   - truePeak  (TP): running max true-peak in dBTP (ITU-R BS.1770-5 Annex 2,
 *     4× polyphase oversampling).
 *
 * @see https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
 */

import {
  ABSOLUTE_GATE_LKFS,
  CHANNEL_WEIGHTS,
  GATING_BLOCK_SECONDS,
  GATING_OVERLAP,
  KWeightingFilter,
  type LoudnessChannel,
  MOMENTARY_SECONDS,
  powerSumToLoudness,
  RELATIVE_GATE_OFFSET_LU,
  SHORT_TERM_SECONDS,
} from "../meters/loudness-core";
import { TruePeakDetector } from "../meters/truepeak-core";

/** Default channel label assignment by channel index for ≤5-channel input. */
const DEFAULT_CHANNEL_ORDER: LoudnessChannel[] = ["L", "R", "C", "Ls", "Rs"];

/**
 * Channel label layout by channel COUNT. Two distinct authorities apply:
 *  - The channel INDEX order for each count is the W3C Web Audio API 1.0
 *    "speakers" layout: 6-channel 5.1 is [FL, FR, FC, LFE, SL, SR] = index 3 is
 *    the LFE (https://www.w3.org/TR/webaudio/#ChannelOrdering).
 *  - The loudness TREATMENT of those channels is ITU-R BS.1770-5 Annex 1
 *    (Table 3 / Fig.1, p.3,7): the LFE is EXCLUDED from the loudness sum
 *    (CHANNEL_WEIGHTS.LFE = 0) and only L/R/C/Ls/Rs are measured (Ls/Rs at 1.41).
 * The flat DEFAULT_CHANNEL_ORDER above cannot express the LFE slot — it would
 * mislabel a 5.1 stream's index-3 LFE as `Ls` and count it as programme
 * loudness — so a layout is chosen by channel count here. Counts not listed fall
 * back to DEFAULT_CHANNEL_ORDER.
 */
const CHANNEL_LAYOUTS: Readonly<Record<number, readonly LoudnessChannel[]>> = {
  1: ["C"], // mono: one measured channel, weight 1.0
  2: ["L", "R"], // stereo
  3: ["L", "R", "C"],
  5: ["L", "R", "C", "Ls", "Rs"], // 5.0
  6: ["L", "R", "C", "LFE", "Ls", "Rs"], // 5.1 — LFE (index 3) excluded
};

interface LoudnessReport {
  type: "loudness";
  momentary: number;
  shortTerm: number;
  integrated: number;
  truePeak: number;
}

/**
 * Maintains the K-weighted mean-square of one channel over a sliding window,
 * plus a 100 ms-hop block accumulator for integrated gating. Pure number
 * crunching; one instance per input channel.
 */
class ChannelMeter {
  readonly kFilter: KWeightingFilter;
  readonly truePeak: TruePeakDetector;

  constructor(sampleRate: number) {
    this.kFilter = new KWeightingFilter(sampleRate);
    // Sample-rate-aware: the detector picks an oversampling factor reaching
    // BS.1770-5's ≥192 kHz requirement (4× at 48 kHz, ≥5× at 44.1 kHz).
    this.truePeak = new TruePeakDetector(sampleRate);
  }
}

/**
 * Ring of recent K-weighted squared samples for one channel, supporting a
 * sliding-window mean-square over the most recent `capacity` samples.
 */
class SlidingPower {
  private readonly ring: Float32Array;
  private head = 0;
  private filled = 0;
  private sum = 0;

  constructor(capacity: number) {
    this.ring = new Float32Array(Math.max(1, capacity));
  }

  push(squared: number): void {
    if (this.filled === this.ring.length) {
      this.sum -= this.ring[this.head];
    } else {
      this.filled++;
    }
    this.ring[this.head] = squared;
    this.sum += squared;
    this.head = (this.head + 1) % this.ring.length;
  }

  meanSquare(): number {
    return this.filled > 0 ? this.sum / this.filled : 0;
  }
}

class LoudnessMeterProcessor extends AudioWorkletProcessor {
  private channelMeters: ChannelMeter[] = [];
  private momentaryWindows: SlidingPower[] = [];
  private shortTermWindows: SlidingPower[] = [];

  // Integrated gating state: per-channel mean-square accumulated per 100 ms
  // block (ITU-R BS.1770-5 Annex 1; 400 ms blocks at 75% overlap == sum of the
  // most recent four 100 ms sub-blocks). We accumulate 100 ms sub-block power
  // and form 400 ms gating blocks from a sliding sum of four sub-blocks.
  private subBlockSamples = 0;
  private samplesIntoSubBlock = 0;
  private subBlockSumPerChannel: number[] = [];
  private recentSubBlocks: number[][] = []; // up to 4 sub-blocks of per-channel sums
  private gatedBlocksPerChannel: number[][] = []; // surviving-absolute-gate block per-channel mean-squares
  private gatedBlockLoudness: number[] = [];

  private channelCount = 0;
  private postCounter = 0;
  private postEverySamples = 0;
  private samplesSincePost = 0;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    // Post readings ~10× per second.
    this.postEverySamples = Math.round(sampleRate / 10);
    this.subBlockSamples = Math.round(GATING_BLOCK_SECONDS * (1 - GATING_OVERLAP) * sampleRate); // 100 ms

    this.port.onmessage = (event: MessageEvent): void => {
      if (event.data && event.data.command === "reset") {
        this.reset();
      }
    };
  }

  private ensureChannels(count: number): void {
    if (count === this.channelCount) {
      return;
    }
    this.channelCount = count;
    this.channelMeters = [];
    this.momentaryWindows = [];
    this.shortTermWindows = [];
    const momentaryCapacity = Math.round(MOMENTARY_SECONDS * sampleRate);
    const shortTermCapacity = Math.round(SHORT_TERM_SECONDS * sampleRate);
    for (let c = 0; c < count; c++) {
      this.channelMeters.push(new ChannelMeter(sampleRate));
      this.momentaryWindows.push(new SlidingPower(momentaryCapacity));
      this.shortTermWindows.push(new SlidingPower(shortTermCapacity));
    }
    this.subBlockSumPerChannel = new Array(count).fill(0);
    this.recentSubBlocks = [];
    this.gatedBlocksPerChannel = [];
    this.gatedBlockLoudness = [];
    this.samplesIntoSubBlock = 0;
  }

  private reset(): void {
    const count = this.channelCount;
    this.channelCount = 0;
    this.ensureChannels(count);
    for (const meter of this.channelMeters) {
      meter.kFilter.reset();
      meter.truePeak.reset();
    }
  }

  private channelLabel(index: number): LoudnessChannel {
    // Pick the layout for the live channel count so a 5.1 stream's index-3 LFE
    // is labelled LFE (weight 0, excluded) rather than mislabelled Ls. Counts
    // without a defined layout fall back to the flat default order.
    const layout = CHANNEL_LAYOUTS[this.channelCount] ?? DEFAULT_CHANNEL_ORDER;
    return layout[index] ?? "C";
  }

  /** Loudness of a per-channel mean-square vector (Annex 1, eqs.1-2). */
  private loudnessOf(meanSquaresPerChannel: number[]): number {
    let weightedSum = 0;
    for (let c = 0; c < meanSquaresPerChannel.length; c++) {
      weightedSum += CHANNEL_WEIGHTS[this.channelLabel(c)] * meanSquaresPerChannel[c];
    }
    return powerSumToLoudness(weightedSum);
  }

  private windowLoudness(windows: SlidingPower[]): number {
    let weightedSum = 0;
    for (let c = 0; c < windows.length; c++) {
      weightedSum += CHANNEL_WEIGHTS[this.channelLabel(c)] * windows[c].meanSquare();
    }
    return powerSumToLoudness(weightedSum);
  }

  /**
   * Closes the current 100 ms sub-block exactly at its boundary: converts the
   * accumulated per-channel power sum to a mean, pushes it onto the ring of the
   * four most-recent sub-blocks, forms a 400 ms gating block (eq.3) when four
   * sub-blocks are available, applies the absolute gate (eq.6), then resets the
   * sub-block accumulator. Called the instant `samplesIntoSubBlock` reaches the
   * boundary so no sample lands in the wrong sub-block.
   */
  private closeSubBlock(): void {
    const subMean = this.subBlockSumPerChannel.map((s) => s / this.subBlockSamples);
    this.recentSubBlocks.push(subMean);
    if (this.recentSubBlocks.length > 4) {
      this.recentSubBlocks.shift();
    }
    // A complete 400 ms gating block exists once four sub-blocks accumulate.
    if (this.recentSubBlocks.length === 4) {
      const blockMean: number[] = new Array(this.channelCount).fill(0);
      for (let c = 0; c < this.channelCount; c++) {
        let s = 0;
        for (const sub of this.recentSubBlocks) {
          s += sub[c];
        }
        blockMean[c] = s / 4;
      }
      const l = this.loudnessOf(blockMean);
      // Absolute gate Γ_a (-70 LKFS): only store passing blocks (Annex 1 eq.6).
      if (l > ABSOLUTE_GATE_LKFS) {
        this.gatedBlocksPerChannel.push(blockMean);
        this.gatedBlockLoudness.push(l);
      }
    }
    this.subBlockSumPerChannel = new Array(this.channelCount).fill(0);
    this.samplesIntoSubBlock -= this.subBlockSamples;
  }

  /** Gated integrated loudness over surviving blocks (Annex 1, eqs.5-7). */
  private computeIntegrated(): number {
    if (this.gatedBlocksPerChannel.length === 0) {
      return -Infinity;
    }
    // Mean of absolute-gated set already filtered on the absolute gate when the
    // block was stored. Compute relative threshold then re-filter.
    const relativeThreshold = this.gatedLoudnessOfSet(this.gatedBlocksPerChannel) + RELATIVE_GATE_OFFSET_LU;
    const finalSet: number[][] = [];
    for (let i = 0; i < this.gatedBlocksPerChannel.length; i++) {
      if (this.gatedBlockLoudness[i] > relativeThreshold) {
        finalSet.push(this.gatedBlocksPerChannel[i]);
      }
    }
    if (finalSet.length === 0) {
      return -Infinity;
    }
    return this.gatedLoudnessOfSet(finalSet);
  }

  private gatedLoudnessOfSet(set: number[][]): number {
    let weightedSum = 0;
    for (let c = 0; c < this.channelCount; c++) {
      let mean = 0;
      for (const block of set) {
        mean += block[c];
      }
      mean /= set.length;
      weightedSum += CHANNEL_WEIGHTS[this.channelLabel(c)] * mean;
    }
    return powerSumToLoudness(weightedSum);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];

    // No input connected this quantum — keep the processor alive.
    if (!input || input.length === 0) {
      return true;
    }

    this.ensureChannels(input.length);

    const frameCount = input[0]?.length ?? 0;

    // True-peak runs on the RAW (un-weighted) channel signal (Annex 2); it has
    // no sub-block boundary dependency, so process whole quanta per channel.
    for (let c = 0; c < input.length; c++) {
      this.channelMeters[c].truePeak.process(input[c]);
    }

    // Pass-through copy: metering must not alter the audible path. Done in one
    // pass so the boundary-split loudness loop below need not also copy.
    if (output) {
      for (let c = 0; c < input.length; c++) {
        const inCh = input[c];
        const outCh = output[c];
        if (outCh) {
          outCh.set(inCh);
        }
      }
    }

    // K-weight, square, and accumulate the sliding windows + 100 ms sub-block.
    // CRITICAL (ITU-R BS.1770-5 Annex 1, eq.3 / p.6 — a gating block is a set of
    // CONTIGUOUS samples of exactly the block duration): a 128-sample render
    // quantum can STRADDLE a sub-block boundary (4800 samples at 48 kHz). We must
    // close the sub-block exactly AT the boundary so no sample lands in the wrong
    // 100 ms sub-block. Walk the quantum in segments bounded by the next sub-block
    // edge; close (and form gating blocks from) the sub-block when it fills.
    let offset = 0;
    while (offset < frameCount) {
      const remainingInSubBlock =
        this.subBlockSamples > 0 ? this.subBlockSamples - this.samplesIntoSubBlock : frameCount - offset;
      const segment = Math.min(remainingInSubBlock, frameCount - offset);
      for (let c = 0; c < input.length; c++) {
        const inCh = input[c];
        const meter = this.channelMeters[c];
        const momentary = this.momentaryWindows[c];
        const shortTerm = this.shortTermWindows[c];
        let subSum = this.subBlockSumPerChannel[c];
        for (let i = offset; i < offset + segment; i++) {
          // K-weight then square for the loudness windows / blocks.
          const y = meter.kFilter.process(inCh[i]);
          const sq = y * y;
          momentary.push(sq);
          shortTerm.push(sq);
          subSum += sq;
        }
        this.subBlockSumPerChannel[c] = subSum;
      }
      offset += segment;
      this.samplesIntoSubBlock += segment;

      // Close a 100 ms sub-block exactly at the boundary.
      if (this.subBlockSamples > 0 && this.samplesIntoSubBlock >= this.subBlockSamples) {
        this.closeSubBlock();
      }
    }

    this.samplesSincePost += frameCount;
    if (this.samplesSincePost >= this.postEverySamples) {
      this.samplesSincePost = 0;
      let maxTruePeak = -Infinity;
      for (const meter of this.channelMeters) {
        const tp = meter.truePeak.truePeakDb();
        if (tp > maxTruePeak) {
          maxTruePeak = tp;
        }
      }
      const report: LoudnessReport = {
        type: "loudness",
        momentary: this.windowLoudness(this.momentaryWindows),
        shortTerm: this.windowLoudness(this.shortTermWindows),
        integrated: this.computeIntegrated(),
        truePeak: maxTruePeak,
      };
      this.port.postMessage(report);
      this.postCounter++;
    }

    return true;
  }
}

registerProcessor("loudness-meter", LoudnessMeterProcessor);
