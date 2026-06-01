import { beforeAll, describe, expect, it } from "vitest";

/*
 * Multi-channel (stereo) phase-vocoder shell tests (Laroche-Dolson 1999 Section
 * 3.5). The cumulative identity-phase-lock rotator Z_u is PER SIGNAL STREAM:
 * each channel must carry its own PeakRotatorState. A single state shared across
 * channels is the regression these tests pin down — within ONE OLA frame
 * channel 0 advances+uses Z_u, then channel 1 advances the SAME peak to Z_{u+1}
 * and uses that, and the two channels also cross-prune each other's peak set.
 *
 * The worklet shell extends AudioWorkletProcessor, which only exists inside an
 * AudioWorklet global scope. We shim the three globals it touches
 * (AudioWorkletProcessor base, registerProcessor, sampleRate) BEFORE importing
 * the shell, then drive the REAL processOLA() multi-channel path directly.
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

// Import AFTER the shim so `extends OLAProcessor` (→ AudioWorkletProcessor) and
// the module-level registerProcessor() call both resolve.
const { PhaseVocoderProcessor } = await import("./phase-vocoder");

const BLOCK_SIZE = 256;
const PITCH_FACTOR = 1.5;

/** A stationary multi-partial real signal that produces several spectral peaks. */
function makeFrame(length: number, phase = 0): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] =
      Math.cos((2 * Math.PI * 8 * i) / length + phase) +
      0.7 * Math.cos((2 * Math.PI * 19 * i) / length + phase) +
      0.4 * Math.cos((2 * Math.PI * 37 * i) / length + phase);
  }
  return out;
}

function makeProcessor(numberOfInputs = 1): InstanceType<typeof PhaseVocoderProcessor> {
  return new PhaseVocoderProcessor({
    numberOfInputs,
    numberOfOutputs: numberOfInputs,
    processorOptions: { blockSize: BLOCK_SIZE },
  });
}

/** pitchFactor parameter as the worklet receives it (k-rate, last value used). */
const pitchParams = (factor: number): Record<string, Float32Array> => ({
  pitchFactor: new Float32Array([factor]),
});

/**
 * Run `frames` OLA frames through `processOLA` for an input that has `channels`
 * channels, each fed `channelInput(j)`. Returns the per-frame output of channel
 * `channel`, copied out (the processor reuses output buffers across frames).
 */
function runChannel(
  proc: InstanceType<typeof PhaseVocoderProcessor>,
  channels: number,
  channelInput: (frame: number, channel: number) => Float32Array,
  channel: number,
  frames: number,
): Float32Array[] {
  const captured: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const inputs: Float32Array[][] = [[]];
    const outputs: Float32Array[][] = [[]];
    for (let c = 0; c < channels; c++) {
      inputs[0].push(channelInput(f, c));
      outputs[0].push(new Float32Array(BLOCK_SIZE));
    }
    proc.processOLA(inputs, outputs, pitchParams(PITCH_FACTOR));
    captured.push(Float32Array.from(outputs[0][channel]));
  }
  return captured;
}

describe("phase-vocoder shell: per-channel cumulative phase (Laroche-Dolson 1999 Section 3.5)", () => {
  beforeAll(() => {
    // Sanity: the shim is in place and the shell imported.
    expect(typeof PhaseVocoderProcessor).toBe("function");
  });

  it("treats stereo channels with identical content identically across frames", () => {
    // Two channels, identical input, identical pitch factor. Per-channel state
    // ⇒ both channels see the SAME cumulative Z_u every frame ⇒ identical
    // output. Shared state ⇒ channel 1's rotators are advanced a second time
    // within each frame (Z_{u+1} vs Z_u) ⇒ the channels diverge.
    const proc = makeProcessor(1);
    const sameInput = () => makeFrame(BLOCK_SIZE);

    const FRAMES = 6;
    const ch0: Float32Array[] = [];
    const ch1: Float32Array[] = [];
    for (let f = 0; f < FRAMES; f++) {
      const inputs: Float32Array[][] = [[sameInput(), sameInput()]];
      const outputs: Float32Array[][] = [[new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)]];
      proc.processOLA(inputs, outputs, pitchParams(PITCH_FACTOR));
      ch0.push(Float32Array.from(outputs[0][0]));
      ch1.push(Float32Array.from(outputs[0][1]));
    }

    // The fix's invariant: identical streams get bit-identical phase treatment.
    for (let f = 0; f < FRAMES; f++) {
      for (let i = 0; i < BLOCK_SIZE; i++) {
        expect(ch1[f][i]).toBe(ch0[f][i]);
      }
    }

    // And the divergence is real to detect: by a later frame the two streams
    // would differ under shared state. Confirm the signal is non-trivial so the
    // equality above is not vacuously comparing zeros.
    const energy = ch0[FRAMES - 1].reduce((s, v) => s + v * v, 0);
    expect(energy).toBeGreaterThan(0);
  });

  it("does not let one channel's peaks corrupt the other channel's output", () => {
    // Channel 0 carries the multi-partial frame; channel 1 carries a DIFFERENT
    // signal (a single low partial), so the two channels detect DIFFERENT peak
    // sets. With shared state, channel 1's advance/prune mutates the rotator map
    // channel 0 relies on. With per-channel state, channel 0's output is exactly
    // what it would be processed ALONE (mono reference).
    const stereoProc = makeProcessor(1);
    const monoProc = makeProcessor(1);

    const FRAMES = 6;
    const ch0Frame = (_f: number) => makeFrame(BLOCK_SIZE);
    const ch1Frame = (_f: number) => {
      const out = new Float32Array(BLOCK_SIZE);
      for (let i = 0; i < BLOCK_SIZE; i++) out[i] = Math.cos((2 * Math.PI * 5 * i) / BLOCK_SIZE);
      return out;
    };

    const stereoCh0 = runChannel(stereoProc, 2, (f, c) => (c === 0 ? ch0Frame(f) : ch1Frame(f)), 0, FRAMES);
    const monoCh0 = runChannel(monoProc, 1, (f) => ch0Frame(f), 0, FRAMES);

    for (let f = 0; f < FRAMES; f++) {
      for (let i = 0; i < BLOCK_SIZE; i++) {
        expect(stereoCh0[f][i]).toBe(monoCh0[f][i]);
      }
    }

    const energy = monoCh0[FRAMES - 1].reduce((s, v) => s + v * v, 0);
    expect(energy).toBeGreaterThan(0);
  });
});
