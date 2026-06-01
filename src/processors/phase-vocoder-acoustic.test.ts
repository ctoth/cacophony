import FFT from "fft.js";
import { beforeAll, describe, expect, it } from "vitest";

/*
 * Phase-vocoder DATA-PLANE resurrection proof (Laroche-Dolson 1999).
 *
 * The control-plane resurrection tests (src/pitch-shift-resurrection.test.ts)
 * prove the worklet is built via `createPhaseVocoderNode` and spliced into the
 * Playback graph with `pitchFactor` forwarded — but they use a FAKE worklet
 * node, so they cannot prove the *signal* is actually pitch-shifted. This file
 * closes that gap: it drives the REAL `PhaseVocoderProcessor.processOLA` and
 * asserts a pure input sinusoid at bin k0 emerges with its spectral peak moved
 * to round(k0 * pitchFactor) — i.e. the previously-dead worklet, when actually
 * run, carries a frequency-shifted signal.
 *
 * Peak LOCATION is set by `shiftPeaks` rigidly translating each peak's region;
 * the identity-phase-lock rotator is unit-modulus and does not move energy, so
 * the shifted-peak-bin assertion is robust to phase and needs no steady-state
 * settling. (Cross-frame phase coherence is exercised separately in
 * phase-vocoder-core.test.ts / phase-vocoder-multichannel.test.ts.)
 */

// --- AudioWorklet global shim (must run before importing the shell) ----------
class FakeAudioWorkletProcessor {
  port = { postMessage() {}, addEventListener() {} } as unknown as MessagePort;
  constructor(_options?: unknown) {}
}
const g = globalThis as unknown as {
  AudioWorkletProcessor: unknown;
  registerProcessor: unknown;
  sampleRate: number;
};
g.AudioWorkletProcessor = FakeAudioWorkletProcessor;
g.registerProcessor = () => {};
g.sampleRate = 44100;

const { PhaseVocoderProcessor } = await import("./phase-vocoder");

const BLOCK_SIZE = 256;

function makeProcessor(): InstanceType<typeof PhaseVocoderProcessor> {
  return new PhaseVocoderProcessor({
    numberOfInputs: 1,
    numberOfOutputs: 1,
    processorOptions: { blockSize: BLOCK_SIZE },
  });
}

const pitchParams = (factor: number): Record<string, Float32Array> => ({
  pitchFactor: new Float32Array([factor]),
});

/** Pure cosine of exactly `bin` cycles across the block (a clean spectral peak at `bin`). */
function sineAtBin(bin: number, frame: number): Float32Array {
  const out = new Float32Array(BLOCK_SIZE);
  // Phase advances by the analysis hop between frames so the input is a single
  // continuous sinusoid, not independent windowed grains.
  const phase = (2 * Math.PI * bin * frame * BLOCK_SIZE) / BLOCK_SIZE; // continuous across frames
  for (let i = 0; i < BLOCK_SIZE; i++) {
    out[i] = Math.cos((2 * Math.PI * bin * i) / BLOCK_SIZE + phase);
  }
  return out;
}

/** Magnitude-spectrum argmax bin of a real signal (ignores DC bin 0). */
function dominantBin(signal: Float32Array): number {
  const fft = new FFT(BLOCK_SIZE);
  const spectrum = fft.createComplexArray();
  fft.realTransform(spectrum, signal as unknown as number[]);
  fft.completeSpectrum(spectrum);
  let bestBin = 0;
  let bestMag = -1;
  for (let bin = 1; bin <= BLOCK_SIZE / 2; bin++) {
    const re = spectrum[bin * 2];
    const im = spectrum[bin * 2 + 1];
    const mag = re * re + im * im;
    if (mag > bestMag) {
      bestMag = mag;
      bestBin = bin;
    }
  }
  return bestBin;
}

/** Run `frames` frames of a continuous sine at `inputBin`; return the last output frame. */
function runPitchShift(inputBin: number, pitchFactor: number, frames = 4): Float32Array {
  const proc = makeProcessor();
  let last = new Float32Array(BLOCK_SIZE);
  for (let f = 0; f < frames; f++) {
    const inputs: Float32Array[][] = [[sineAtBin(inputBin, f)]];
    const outputs: Float32Array[][] = [[new Float32Array(BLOCK_SIZE)]];
    proc.processOLA(inputs, outputs, pitchParams(pitchFactor));
    last = Float32Array.from(outputs[0][0]);
  }
  return last;
}

describe("phase-vocoder data-plane: the resurrected worklet actually shifts pitch", () => {
  beforeAll(() => {
    expect(typeof PhaseVocoderProcessor).toBe("function");
  });

  it("shifts a pure tone UP an octave: bin 16 -> ~bin 32 at pitchFactor 2", () => {
    const out = runPitchShift(16, 2.0);
    // Non-vacuous: prove the output carries signal before asserting where.
    const energy = out.reduce((s, v) => s + v * v, 0);
    expect(energy).toBeGreaterThan(0);
    // The fundamental moved to round(16 * 2) = 32 (±1 bin for windowing).
    expect(dominantBin(out)).toBeGreaterThanOrEqual(31);
    expect(dominantBin(out)).toBeLessThanOrEqual(33);
  });

  it("shifts a pure tone DOWN an octave: bin 32 -> ~bin 16 at pitchFactor 0.5", () => {
    const out = runPitchShift(32, 0.5);
    const energy = out.reduce((s, v) => s + v * v, 0);
    expect(energy).toBeGreaterThan(0);
    expect(dominantBin(out)).toBeGreaterThanOrEqual(15);
    expect(dominantBin(out)).toBeLessThanOrEqual(17);
  });

  it("is a NO-OP at pitchFactor 1: bin 24 stays at bin 24", () => {
    const out = runPitchShift(24, 1.0);
    expect(dominantBin(out)).toBe(24);
  });

  it("does not move the peak to a wrong bin (guards against a vacuous pass)", () => {
    // A naive bypass would leave bin 16 at 16 under pitchFactor 2; assert it did NOT.
    const out = runPitchShift(16, 2.0);
    expect(dominantBin(out)).not.toBe(16);
  });
});
