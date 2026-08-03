import FFT from "fft.js";
import { describe, expect, it } from "vitest";

import { designHilbertFir, FrequencyShifterCore } from "./frequency-shifter-core";

const SAMPLE_RATE = 48000;

function spectrum(signal: Float32Array): Float64Array {
  const fft = new FFT(signal.length);
  const bins = fft.createComplexArray();
  fft.realTransform(bins, signal as unknown as number[]);
  const out = new Float64Array(signal.length / 2 + 1);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(bins[i * 2], bins[i * 2 + 1]);
  return out;
}

function runTone(inputBin: number, shiftBins: number): Float64Array {
  const n = 16384;
  const warmup = 1024;
  const core = new FrequencyShifterCore(SAMPLE_RATE);
  const output = new Float32Array(n + warmup);
  const inputFrequency = (inputBin * SAMPLE_RATE) / n;
  const shiftFrequency = (shiftBins * SAMPLE_RATE) / n;
  for (let i = 0; i < output.length; i++) {
    const input = Math.cos((2 * Math.PI * inputFrequency * i) / SAMPLE_RATE);
    output[i] = core.processSample(input, { frequency: shiftFrequency, mix: 1 });
  }
  return spectrum(output.slice(warmup));
}

describe("Hilbert single-sideband frequency shifter", () => {
  it("designs an odd-symmetric Hilbert FIR with the even offsets suppressed", () => {
    const coefficients = designHilbertFir(127);
    const center = 63;
    expect(coefficients[center]).toBe(0);
    for (let offset = 1; offset <= center; offset++) {
      expect(coefficients[center - offset]).toBeCloseTo(-coefficients[center + offset], 12);
      if (offset % 2 === 0) expect(coefficients[center + offset]).toBe(0);
    }
  });

  it("moves a tone to only the upper sideband and rejects the mirror image", () => {
    const inputBin = 1024;
    const shiftBins = 256;
    const magnitudes = runTone(inputBin, shiftBins);
    const target = magnitudes[inputBin + shiftBins];
    const mirror = magnitudes[inputBin - shiftBins];
    expect(target).toBeGreaterThan(1000); // non-vacuous signal
    expect(target).toBeGreaterThan(mirror * 20);
  });

  it("a negative carrier translates the same tone downward", () => {
    const inputBin = 1024;
    const shiftBins = -256;
    const magnitudes = runTone(inputBin, shiftBins);
    expect(magnitudes[inputBin + shiftBins]).toBeGreaterThan(magnitudes[inputBin - shiftBins] * 20);
  });
});
