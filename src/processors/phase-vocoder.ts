import FFT from "fft.js";
import OLAProcessor from "./ola";
import { computeMagnitudes, findPeaks, PeakRotatorState, shiftPeaks } from "./phase-vocoder-core";

/*
 * Phase-vocoder AudioWorklet shell — peak-based pitch-shifter with Identity
 * Phase-Locking, Jean Laroche & Mark Dolson, "New Phase-Vocoder Techniques for
 * Pitch-Shifting, Harmonizing and Other Exotic Effects", Proc. 1999 IEEE WASPAA.
 *
 * This file owns the worklet plumbing (FFT framing on top of OLAProcessor,
 * parameterDescriptors, the registerProcessor call). The peak detection,
 * region-of-influence translation and the Laroche-Dolson 1999 Section 3.5
 * identity-phase-lock rotation live in the context-free, unit-tested
 * phase-vocoder-core.ts (mirroring the waveshaper / dynamics core/shell split).
 */

const BUFFERED_BLOCK_SIZE = 2048;

function genHannWindow(length: number): Float32Array {
  const win = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return win;
}

interface PhaseVocoderProcessorOptions {
  blockSize: number;
}

export class PhaseVocoderProcessor extends OLAProcessor {
  fftSize: number;
  timeCursor: number;
  rotators: PeakRotatorState;
  hannWindow: Float32Array;
  fft: FFT;
  // fft.js with a Float32Array input returns a flat interleaved Float32Array
  // of length 2*size (real/imag pairs). The library's types are `any[]` so we
  // narrow at the perimeter — see allocation site below.
  freqComplexBuffer: Float32Array;
  freqComplexBufferShifted: Float32Array;
  timeComplexBuffer: Float32Array;
  magnitudes: Float32Array;
  peakIndexes: Int32Array;
  nbPeaks: number;

  static get parameterDescriptors() {
    return [
      {
        name: "pitchFactor",
        defaultValue: 1.0,
      },
    ];
  }

  constructor(options?: AudioWorkletNodeOptions) {
    // Merge defaults with caller-supplied processorOptions (caller wins).
    const baseOptions: AudioWorkletNodeOptions = options ?? {};
    const callerOpts = (baseOptions.processorOptions ?? {}) as Partial<PhaseVocoderProcessorOptions>;
    baseOptions.processorOptions = {
      blockSize: BUFFERED_BLOCK_SIZE,
      ...callerOpts,
    } satisfies PhaseVocoderProcessorOptions;
    super(baseOptions);

    this.fftSize = this.blockSize;
    this.timeCursor = 0;
    // Per-peak cumulative phase-lock state (Laroche-Dolson 1999 Section 3.5):
    // Z_{u+1} = Z_u * exp(j*Delta-omega*R), advanced once per frame.
    this.rotators = new PeakRotatorState();

    this.hannWindow = genHannWindow(this.blockSize);

    // prepare FFT and pre-allocate buffers
    this.fft = new FFT(this.fftSize);
    // fft.js returns its complex array as `any[]`; runtime is a flat Float32Array.
    this.freqComplexBuffer = this.fft.createComplexArray() as unknown as Float32Array;
    this.freqComplexBufferShifted = this.fft.createComplexArray() as unknown as Float32Array;
    this.timeComplexBuffer = this.fft.createComplexArray() as unknown as Float32Array;
    this.magnitudes = new Float32Array(this.fftSize / 2 + 1);
    this.peakIndexes = new Int32Array(this.magnitudes.length);
    this.nbPeaks = 0;
  }

  processOLA(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): void {
    const pitchFactor = parameters.pitchFactor[parameters.pitchFactor.length - 1];

    for (let i = 0; i < this.nbInputs; i++) {
      for (let j = 0; j < inputs[i].length; j++) {
        const input = inputs[i][j];
        const output = outputs[i][j];

        this.applyHannWindow(input);

        this.fft.realTransform(this.freqComplexBuffer, input);

        // Peak detect + region-of-influence translate + Laroche-Dolson 1999
        // Section 3.5 identity-phase-lock rotation (one Z_u per peak applied
        // uniformly to its region). All math in the unit-tested core.
        computeMagnitudes(this.freqComplexBuffer, this.magnitudes);
        this.nbPeaks = findPeaks(this.magnitudes, this.peakIndexes);
        // Accumulate each peak's cumulative rotator Z_u by this frame's
        // exp(j*Delta-omega*R) BEFORE applying it (Laroche-Dolson 1999 Section
        // 3.5 cross-frame cumulation). hopSize is the synthesis hop R.
        this.rotators.advance(this.peakIndexes, this.nbPeaks, this.fftSize, pitchFactor, this.hopSize);
        shiftPeaks(
          this.freqComplexBuffer,
          this.freqComplexBufferShifted,
          this.peakIndexes,
          this.nbPeaks,
          this.fftSize,
          this.magnitudes.length,
          pitchFactor,
          this.rotators,
        );

        this.fft.completeSpectrum(this.freqComplexBufferShifted);
        this.fft.inverseTransform(this.timeComplexBuffer, this.freqComplexBufferShifted);
        this.fft.fromComplexArray(this.timeComplexBuffer, output);

        this.applyHannWindow(output);
      }
    }

    this.timeCursor += this.hopSize;
  }

  private applyHannWindow(input: Float32Array) {
    for (let i = 0; i < this.blockSize; i++) {
      input[i] *= this.hannWindow[i];
    }
  }
}

registerProcessor("phase-vocoder", PhaseVocoderProcessor);
console.log("PhaseVocoderProcessor registered");
