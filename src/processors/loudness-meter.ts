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
    this.truePeak = new TruePeakDetector();
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
    return DEFAULT_CHANNEL_ORDER[index] ?? "C";
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

    for (let c = 0; c < input.length; c++) {
      const inCh = input[c];
      const outCh = output?.[c];
      const meter = this.channelMeters[c];

      // True-peak runs on the RAW (un-weighted) channel signal (Annex 2).
      meter.truePeak.process(inCh);

      for (let i = 0; i < frameCount; i++) {
        const x = inCh[i];
        // Pass-through copy: metering must not alter the audible path.
        if (outCh) {
          outCh[i] = x;
        }
        // K-weight then square for the loudness windows / blocks.
        const y = meter.kFilter.process(x);
        const sq = y * y;
        this.momentaryWindows[c].push(sq);
        this.shortTermWindows[c].push(sq);
        this.subBlockSumPerChannel[c] += sq;
      }
    }

    // Advance the 100 ms sub-block accumulator.
    this.samplesIntoSubBlock += frameCount;
    while (this.samplesIntoSubBlock >= this.subBlockSamples && this.subBlockSamples > 0) {
      // Close a 100 ms sub-block: convert summed power to per-channel mean.
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
