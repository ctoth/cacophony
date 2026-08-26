import { describe, expect, it } from "vitest";

import {
  type BccEncoderConfig,
  BccEncoderState,
  buildErbPartitionTable,
  DEFAULT_BCC_CONFIG,
  partitionCount,
} from "./bcc-encoder-core";

interface EncoderFrame {
  leftRe: Float32Array;
  leftIm: Float32Array;
  rightRe: Float32Array;
  rightIm: Float32Array;
  wRe: Float32Array;
  wIm: Float32Array;
  yRe: Float32Array;
  yIm: Float32Array;
  zRe: Float32Array;
  zIm: Float32Array;
  xRe: Float32Array;
  xIm: Float32Array;
}

function createState(overrides: Partial<BccEncoderConfig> = {}): BccEncoderState {
  return new BccEncoderState({
    ...DEFAULT_BCC_CONFIG,
    sampleRate: 48_000,
    hopSize: 128,
    ...overrides,
  });
}

function createFrame(state: BccEncoderState): EncoderFrame {
  const array = () => new Float32Array(state.numBins);
  return {
    leftRe: array(),
    leftIm: array(),
    rightRe: array(),
    rightIm: array(),
    wRe: array(),
    wIm: array(),
    yRe: array(),
    yIm: array(),
    zRe: array(),
    zIm: array(),
    xRe: array(),
    xIm: array(),
  };
}

function encode(state: BccEncoderState, frame: EncoderFrame): void {
  state.analyzeAndEncode(
    frame.leftRe,
    frame.leftIm,
    frame.rightRe,
    frame.rightIm,
    frame.wRe,
    frame.wIm,
    frame.yRe,
    frame.yIm,
    frame.zRe,
    frame.zIm,
    frame.xRe,
    frame.xIm,
  );
}

function binsInOneHighPartition(state: BccEncoderState): number[] {
  const byPartition = new Map<number, number[]>();
  for (let bin = 0; bin < state.numBins; bin++) {
    const frequencyHz = (bin / state.config.fftSize) * state.config.sampleRate;
    if (frequencyHz < 2_000) continue;
    const partition = state.binToPartition[bin];
    const bins = byPartition.get(partition) ?? [];
    bins.push(bin);
    byPartition.set(partition, bins);
  }
  const match = Array.from(byPartition.values()).find((bins) => bins.length >= 4);
  if (!match) throw new Error("expected a high-frequency ERB partition with at least four bins");
  return match.slice(0, 4);
}

describe("BccEncoderState", () => {
  it("encodes hard-panned spectra with opposite horizontal signs", () => {
    const bin = 64;
    const leftState = createState();
    const left = createFrame(leftState);
    left.leftRe[bin] = 1;
    encode(leftState, left);

    const rightState = createState();
    const right = createFrame(rightState);
    right.rightRe[bin] = 1;
    encode(rightState, right);

    expect(left.wRe[bin]).toBeGreaterThan(0);
    expect(left.yRe[bin]).toBeGreaterThan(0);
    expect(right.wRe[bin]).toBeGreaterThan(0);
    expect(right.yRe[bin]).toBeLessThan(0);
    expect(Array.from(left.zRe)).toEqual(new Array(leftState.numBins).fill(0));
    expect(Array.from(left.xRe)).toEqual(new Array(leftState.numBins).fill(0));
  });

  it("drops decorrelated equal-power content from Y while preserving W", () => {
    const state = createState();
    const frame = createFrame(state);
    const bins = binsInOneHighPartition(state);

    for (let index = 0; index < bins.length; index++) {
      const bin = bins[index];
      frame.leftRe[bin] = 1;
      frame.rightRe[bin] = index % 2 === 0 ? 1 : -1;
    }
    encode(state, frame);

    expect(Math.max(...bins.map((bin) => Math.abs(frame.wRe[bin])))).toBeGreaterThan(0.5);
    expect(Math.max(...bins.map((bin) => Math.abs(frame.yRe[bin])))).toBeLessThan(1e-6);
  });

  it("applies lowSuppression to the bass Y cue while preserving W", () => {
    const state = createState();
    const frame = createFrame(state);
    const bassBin = 1;
    frame.leftRe[bassBin] = 1;
    encode(state, frame);

    expect(frame.wRe[bassBin]).toBeGreaterThan(0.5);
    expect(frame.yRe[bassBin]).toBe(0);

    const retainedState = createState({ lowSuppression: 0.5 });
    const retained = createFrame(retainedState);
    retained.leftRe[bassBin] = 1;
    encode(retainedState, retained);
    expect(retained.yRe[bassBin]).toBeGreaterThan(0.3);
  });

  it("derives smoothing convergence from the configured frame rate", () => {
    const state = createState({ smoothingTauSeconds: 0.1 });
    const bin = 64;
    const partition = state.binToPartition[bin];

    const centered = createFrame(state);
    centered.leftRe[bin] = 1;
    centered.rightRe[bin] = 1;
    encode(state, centered);

    const leftOnly = createFrame(state);
    leftOnly.leftRe[bin] = 1;
    encode(state, leftOnly);

    const pan = new Float64Array(state.numPartitions);
    state.panPerPartition(pan);
    const expectedAlpha = Math.exp(-1 / (0.1 * (48_000 / 128)));

    expect(state.smoothingAlpha).toBeCloseTo(expectedAlpha, 12);
    expect(pan[partition]).toBeCloseTo(1 / (1 + 2 * expectedAlpha), 6);
  });

  it("clears smoothed diagnostics on reset", () => {
    const state = createState();
    const frame = createFrame(state);
    const bin = 64;
    const partition = state.binToPartition[bin];
    frame.leftRe[bin] = 1;
    frame.rightRe[bin] = 0.25;
    encode(state, frame);

    const coherence = new Float64Array(state.numPartitions);
    const pan = new Float64Array(state.numPartitions);
    state.iccPerPartition(coherence);
    state.panPerPartition(pan);
    expect(coherence[partition]).toBeGreaterThan(0);
    expect(pan[partition]).toBeGreaterThan(0);

    state.reset();
    state.iccPerPartition(coherence);
    state.panPerPartition(pan);
    expect(Array.from(coherence)).toEqual(new Array(state.numPartitions).fill(0));
    expect(Array.from(pan)).toEqual(new Array(state.numPartitions).fill(0));
  });
});

describe("ERB partition table", () => {
  it("is monotone and covers every one-sided FFT bin without gaps", () => {
    const fftSize = 512;
    const table = buildErbPartitionTable(48_000, fftSize, 2);
    const count = partitionCount(table);

    expect(table).toHaveLength(fftSize / 2 + 1);
    expect(table[0]).toBe(0);
    for (let bin = 1; bin < table.length; bin++) {
      expect(table[bin]).toBeGreaterThanOrEqual(table[bin - 1]);
      expect(table[bin] - table[bin - 1]).toBeLessThanOrEqual(1);
    }
    expect(new Set(table).size).toBe(count);
    expect(table[table.length - 1]).toBe(count - 1);
  });
});
