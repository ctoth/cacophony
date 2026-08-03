import FFT from "fft.js";
import { describe, expect, it } from "vitest";

import { BarberpoleCore } from "./barberpole-core";

const SAMPLE_RATE = 48000;

describe("SSB spectral-delay barberpole", () => {
  it("the 32-stage -0.5 spectral delay creates a bank of deep notches", () => {
    const n = 16384;
    const core = new BarberpoleCore(SAMPLE_RATE);
    const impulse = new Float32Array(n);
    const response = new Float32Array(n);
    impulse[0] = 1;
    core.process(impulse, response, { rate: 0, stages: 32, coefficient: -0.5, mix: 1 });

    const fft = new FFT(n);
    const bins = fft.createComplexArray();
    fft.realTransform(bins, response as unknown as number[]);
    const magnitudes = new Float64Array(n / 2 + 1);
    let max = 0;
    for (let bin = 1; bin < magnitudes.length; bin++) {
      magnitudes[bin] = Math.hypot(bins[bin * 2], bins[bin * 2 + 1]);
      max = Math.max(max, magnitudes[bin]);
    }
    let notches = 0;
    for (let bin = 2; bin < magnitudes.length - 1; bin++) {
      if (
        magnitudes[bin] < max * 0.15 &&
        magnitudes[bin] < magnitudes[bin - 1] &&
        magnitudes[bin] <= magnitudes[bin + 1]
      )
        notches++;
    }
    expect(max).toBeGreaterThan(0);
    expect(notches).toBeGreaterThanOrEqual(8);
  });

  it("remains finite across repeated carrier wraps in either travel direction", () => {
    for (const rate of [-2, 2]) {
      const core = new BarberpoleCore(100);
      let peak = 0;
      for (let i = 0; i < 10000; i++) {
        const output = core.processSample(i % 17 === 0 ? 1 : 0, { rate, stages: 32, coefficient: -0.5, mix: 1 });
        expect(Number.isFinite(output)).toBe(true);
        peak = Math.max(peak, Math.abs(output));
      }
      expect(peak).toBeGreaterThan(0);
    }
  });
});
