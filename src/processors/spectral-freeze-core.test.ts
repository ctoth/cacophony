import { describe, expect, it } from "vitest";

import { SpectralFreezeState } from "./spectral-freeze-core";

function frame(binCount: number, bin: number, magnitude: number, phase: number): Float32Array {
  const out = new Float32Array(binCount * 2);
  out[bin * 2] = magnitude * Math.cos(phase);
  out[bin * 2 + 1] = magnitude * Math.sin(phase);
  return out;
}

describe("phase-continuing spectral freeze", () => {
  it("holds captured magnitude while continuing the measured inter-frame phase", () => {
    const bins = 17;
    const state = new SpectralFreezeState(bins, 32, 8);
    const output = new Float32Array(bins * 2);
    state.process(frame(bins, 5, 2, 0), output, false, 0, 1);
    state.process(frame(bins, 5, 2, 0.4), output, false, 0, 1);
    state.process(frame(bins, 5, 2, 0.8), output, true, 0, 1);
    const capturedPhase = Math.atan2(output[11], output[10]);
    state.process(new Float32Array(bins * 2), output, true, 0, 1);
    const continuedPhase = Math.atan2(output[11], output[10]);
    expect(Math.hypot(output[10], output[11])).toBeCloseTo(2, 5);
    expect(Math.atan2(Math.sin(continuedPhase - capturedPhase), Math.cos(continuedPhase - capturedPhase))).toBeCloseTo(
      0.4,
      5,
    );
  });

  it("smear averages the neighboring capture-frame magnitudes", () => {
    const bins = 9;
    const state = new SpectralFreezeState(bins, 16, 4);
    const output = new Float32Array(bins * 2);
    state.process(frame(bins, 3, 1, 0), output, false, 1, 1);
    state.process(frame(bins, 3, 2, 0), output, false, 1, 1);
    state.process(frame(bins, 3, 6, 0), output, true, 1, 1);
    expect(Math.hypot(output[6], output[7])).toBeCloseTo(3, 5);
  });

  it("release returns the live spectrum exactly", () => {
    const bins = 9;
    const state = new SpectralFreezeState(bins, 16, 4);
    const output = new Float32Array(bins * 2);
    state.process(frame(bins, 3, 2, 0), output, true, 0, 1);
    const live = frame(bins, 4, 7, 1.2);
    state.process(live, output, false, 0, 1);
    expect(Array.from(output)).toEqual(Array.from(live));
  });
});
