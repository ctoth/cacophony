import FFT from "fft.js";
import { BccEncoderState, DEFAULT_BCC_CONFIG } from "./bcc-encoder-core";
import OLAProcessor from "./ola";

const WORKLET_LOG_PREFIX = "[cacophony/worklet:bcc-encoder]";

function genHannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let frame = 0; frame < length; frame++) {
    window[frame] = 0.5 * (1 - Math.cos((2 * Math.PI * frame) / length));
  }
  return window;
}

interface BccEncoderProcessorOptions {
  blockSize: number;
}

export class BccEncoderProcessor extends OLAProcessor {
  private readonly encoder: BccEncoderState;
  private readonly fft: FFT;
  private readonly hannWindow: Float32Array;
  private readonly leftWindowed: Float32Array;
  private readonly rightWindowed: Float32Array;
  private readonly leftSpectrum: Float32Array;
  private readonly rightSpectrum: Float32Array;
  private readonly outputSpectrum: Float32Array;
  private readonly outputTimeComplex: Float32Array;
  private readonly leftRe: Float32Array;
  private readonly leftIm: Float32Array;
  private readonly rightRe: Float32Array;
  private readonly rightIm: Float32Array;
  private readonly wRe: Float32Array;
  private readonly wIm: Float32Array;
  private readonly yRe: Float32Array;
  private readonly yIm: Float32Array;
  private readonly zRe: Float32Array;
  private readonly zIm: Float32Array;
  private readonly xRe: Float32Array;
  private readonly xIm: Float32Array;

  constructor(options?: AudioWorkletNodeOptions) {
    const baseOptions = options ?? {};
    const callerOptions = (baseOptions.processorOptions ?? {}) as Partial<BccEncoderProcessorOptions>;
    baseOptions.processorOptions = {
      blockSize: DEFAULT_BCC_CONFIG.fftSize,
      ...callerOptions,
    } satisfies BccEncoderProcessorOptions;
    super(baseOptions);

    this.fft = new FFT(this.blockSize);
    this.hannWindow = genHannWindow(this.blockSize);
    this.leftWindowed = new Float32Array(this.blockSize);
    this.rightWindowed = new Float32Array(this.blockSize);
    this.leftSpectrum = this.fft.createComplexArray() as unknown as Float32Array;
    this.rightSpectrum = this.fft.createComplexArray() as unknown as Float32Array;
    this.outputSpectrum = this.fft.createComplexArray() as unknown as Float32Array;
    this.outputTimeComplex = this.fft.createComplexArray() as unknown as Float32Array;

    const numBins = this.blockSize / 2 + 1;
    const bins = () => new Float32Array(numBins);
    this.leftRe = bins();
    this.leftIm = bins();
    this.rightRe = bins();
    this.rightIm = bins();
    this.wRe = bins();
    this.wIm = bins();
    this.yRe = bins();
    this.yIm = bins();
    this.zRe = bins();
    this.zIm = bins();
    this.xRe = bins();
    this.xIm = bins();

    this.encoder = new BccEncoderState({
      ...DEFAULT_BCC_CONFIG,
      sampleRate,
      fftSize: this.blockSize,
      hopSize: this.hopSize,
    });
    this.port.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (typeof message === "object" && message !== null && "type" in message && message.type === "reset") {
        this.encoder.reset();
      }
    };
  }

  processOLA(inputs: Float32Array[][], outputs: Float32Array[][], _parameters: Record<string, Float32Array>): void {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length < 2 || !output || output.length < 4) {
      output?.forEach((channel) => channel.fill(0));
      return;
    }

    this.windowInput(input[0], this.leftWindowed);
    this.windowInput(input[1], this.rightWindowed);
    this.fft.realTransform(this.leftSpectrum, this.leftWindowed);
    this.fft.realTransform(this.rightSpectrum, this.rightWindowed);
    this.deinterleave(this.leftSpectrum, this.leftRe, this.leftIm);
    this.deinterleave(this.rightSpectrum, this.rightRe, this.rightIm);

    this.encoder.analyzeAndEncode(
      this.leftRe,
      this.leftIm,
      this.rightRe,
      this.rightIm,
      this.wRe,
      this.wIm,
      this.yRe,
      this.yIm,
      this.zRe,
      this.zIm,
      this.xRe,
      this.xIm,
    );

    this.inverseToOutput(this.wRe, this.wIm, output[0]);
    this.inverseToOutput(this.yRe, this.yIm, output[1]);
    output[2].fill(0);
    output[3].fill(0);
  }

  private windowInput(input: Float32Array, output: Float32Array): void {
    for (let frame = 0; frame < this.blockSize; frame++) {
      output[frame] = input[frame] * this.hannWindow[frame];
    }
  }

  private deinterleave(spectrum: Float32Array, real: Float32Array, imaginary: Float32Array): void {
    for (let bin = 0; bin < real.length; bin++) {
      real[bin] = spectrum[2 * bin];
      imaginary[bin] = spectrum[2 * bin + 1];
    }
  }

  private inverseToOutput(real: Float32Array, imaginary: Float32Array, output: Float32Array): void {
    this.outputSpectrum.fill(0);
    for (let bin = 0; bin < real.length; bin++) {
      this.outputSpectrum[2 * bin] = real[bin];
      this.outputSpectrum[2 * bin + 1] = imaginary[bin];
    }
    this.fft.completeSpectrum(this.outputSpectrum);
    this.fft.inverseTransform(this.outputTimeComplex, this.outputSpectrum);
    this.fft.fromComplexArray(this.outputTimeComplex, output);
    for (let frame = 0; frame < this.blockSize; frame++) {
      output[frame] *= this.hannWindow[frame];
    }
  }
}

console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
try {
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor start`);
  registerProcessor("bcc-encoder", BccEncoderProcessor);
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
} catch (error) {
  console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
  throw error;
}
