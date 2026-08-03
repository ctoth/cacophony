import FFT from "fft.js";
import OLAProcessor from "./ola";
import { computeMagnitudes, findPeaks, PeakRotatorState, shiftPeaks } from "./phase-vocoder-core";

const BLOCK_SIZE = 2048;

function hann(length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  return out;
}

/** Two added voices in one Laroche-Dolson STFT analysis pass. */
export class HarmonizerWorkletProcessor extends OLAProcessor {
  private readonly fft: FFT;
  private readonly window: Float32Array;
  private readonly sourceSpectrum: Float32Array;
  private readonly voiceASpectrum: Float32Array;
  private readonly voiceBSpectrum: Float32Array;
  private readonly outputSpectrum: Float32Array;
  private readonly timeComplex: Float32Array;
  private readonly magnitudes: Float32Array;
  private readonly peaks: Int32Array;
  private voiceAStates: PeakRotatorState[] = [];
  private voiceBStates: PeakRotatorState[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: "semitonesA", defaultValue: 7, minValue: -36, maxValue: 36, automationRate: "k-rate" },
      { name: "semitonesB", defaultValue: 12, minValue: -36, maxValue: 36, automationRate: "k-rate" },
      { name: "gainA", defaultValue: 0.6, minValue: 0, maxValue: 2, automationRate: "k-rate" },
      { name: "gainB", defaultValue: 0.45, minValue: 0, maxValue: 2, automationRate: "k-rate" },
      { name: "dry", defaultValue: 1, minValue: 0, maxValue: 2, automationRate: "k-rate" },
    ];
  }

  constructor(options?: AudioWorkletNodeOptions) {
    const workletOptions = options ?? {};
    workletOptions.processorOptions = { blockSize: BLOCK_SIZE, ...((workletOptions.processorOptions ?? {}) as object) };
    super(workletOptions);
    this.fft = new FFT(this.blockSize);
    this.window = hann(this.blockSize);
    this.sourceSpectrum = this.fft.createComplexArray() as unknown as Float32Array;
    this.voiceASpectrum = this.fft.createComplexArray() as unknown as Float32Array;
    this.voiceBSpectrum = this.fft.createComplexArray() as unknown as Float32Array;
    this.outputSpectrum = this.fft.createComplexArray() as unknown as Float32Array;
    this.timeComplex = this.fft.createComplexArray() as unknown as Float32Array;
    this.magnitudes = new Float32Array(this.blockSize / 2 + 1);
    this.peaks = new Int32Array(this.magnitudes.length);
  }

  processOLA(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): void {
    const factorA = 2 ** (parameters.semitonesA[parameters.semitonesA.length - 1] / 12);
    const factorB = 2 ** (parameters.semitonesB[parameters.semitonesB.length - 1] / 12);
    const gainA = parameters.gainA[parameters.gainA.length - 1];
    const gainB = parameters.gainB[parameters.gainB.length - 1];
    const dry = parameters.dry[parameters.dry.length - 1];
    const norm = 1 / Math.max(1, dry + gainA + gainB);

    for (let channel = 0; channel < inputs[0].length; channel++) {
      const input = inputs[0][channel];
      const output = outputs[0][channel];
      for (let i = 0; i < input.length; i++) input[i] *= this.window[i];
      this.fft.realTransform(this.sourceSpectrum, input);
      computeMagnitudes(this.sourceSpectrum, this.magnitudes);
      const peakCount = findPeaks(this.magnitudes, this.peaks);

      const stateA = (this.voiceAStates[channel] ??= new PeakRotatorState());
      const stateB = (this.voiceBStates[channel] ??= new PeakRotatorState());
      stateA.advance(this.peaks, peakCount, this.blockSize, factorA, this.hopSize);
      stateB.advance(this.peaks, peakCount, this.blockSize, factorB, this.hopSize);
      shiftPeaks(
        this.sourceSpectrum,
        this.voiceASpectrum,
        this.peaks,
        peakCount,
        this.blockSize,
        this.magnitudes.length,
        factorA,
        stateA,
      );
      shiftPeaks(
        this.sourceSpectrum,
        this.voiceBSpectrum,
        this.peaks,
        peakCount,
        this.blockSize,
        this.magnitudes.length,
        factorB,
        stateB,
      );

      this.outputSpectrum.fill(0);
      for (let bin = 0; bin < this.magnitudes.length; bin++) {
        const i = bin * 2;
        this.outputSpectrum[i] =
          (dry * this.sourceSpectrum[i] + gainA * this.voiceASpectrum[i] + gainB * this.voiceBSpectrum[i]) * norm;
        this.outputSpectrum[i + 1] =
          (dry * this.sourceSpectrum[i + 1] + gainA * this.voiceASpectrum[i + 1] + gainB * this.voiceBSpectrum[i + 1]) *
          norm;
      }
      this.fft.completeSpectrum(this.outputSpectrum);
      this.fft.inverseTransform(this.timeComplex, this.outputSpectrum);
      this.fft.fromComplexArray(this.timeComplex, output);
      for (let i = 0; i < output.length; i++) output[i] *= this.window[i];
    }
  }
}

registerProcessor("harmonizer", HarmonizerWorkletProcessor);
