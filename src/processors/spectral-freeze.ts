import FFT from "fft.js";
import OLAProcessor from "./ola";
import { SpectralFreezeState } from "./spectral-freeze-core";

const BLOCK_SIZE = 2048;

export class SpectralFreezeWorkletProcessor extends OLAProcessor {
  private readonly fft: FFT;
  private readonly window: Float32Array;
  private readonly inputSpectrum: Float32Array;
  private readonly outputSpectrum: Float32Array;
  private readonly timeComplex: Float32Array;
  private states: SpectralFreezeState[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: "freeze", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "smear", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor(options?: AudioWorkletNodeOptions) {
    const workletOptions = options ?? {};
    workletOptions.processorOptions = { blockSize: BLOCK_SIZE, ...((workletOptions.processorOptions ?? {}) as object) };
    super(workletOptions);
    this.fft = new FFT(this.blockSize);
    this.window = new Float32Array(this.blockSize);
    for (let i = 0; i < this.blockSize; i++) this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / this.blockSize));
    this.inputSpectrum = this.fft.createComplexArray() as unknown as Float32Array;
    this.outputSpectrum = this.fft.createComplexArray() as unknown as Float32Array;
    this.timeComplex = this.fft.createComplexArray() as unknown as Float32Array;
  }

  processOLA(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): void {
    const frozen = parameters.freeze[parameters.freeze.length - 1] >= 0.5;
    const smear = parameters.smear[parameters.smear.length - 1];
    const mix = parameters.mix[parameters.mix.length - 1];
    const bins = this.blockSize / 2 + 1;
    for (let channel = 0; channel < inputs[0].length; channel++) {
      const input = inputs[0][channel];
      const output = outputs[0][channel];
      for (let i = 0; i < input.length; i++) input[i] *= this.window[i];
      this.fft.realTransform(this.inputSpectrum, input);
      const state = (this.states[channel] ??= new SpectralFreezeState(bins, this.blockSize, this.hopSize));
      state.process(this.inputSpectrum, this.outputSpectrum, frozen, smear, mix);
      this.fft.completeSpectrum(this.outputSpectrum);
      this.fft.inverseTransform(this.timeComplex, this.outputSpectrum);
      this.fft.fromComplexArray(this.timeComplex, output);
      for (let i = 0; i < output.length; i++) output[i] *= this.window[i];
    }
  }
}

registerProcessor("spectral-freeze", SpectralFreezeWorkletProcessor);
