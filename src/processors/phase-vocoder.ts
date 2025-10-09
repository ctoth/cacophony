import OLAProcessor from "./ola.ts";
import FFT from "fft.js";

const BUFFERED_BLOCK_SIZE = 2048;

function genHannWindow(length: number): Float32Array {
  let win = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return win;
}

interface PhaseVocoderNodeOptions extends AudioWorkletNodeOptions {
  processorOptions: {
    blockSize: number;
  };
}

export class PhaseVocoderProcessor extends OLAProcessor {
  fftSize: number;
  timeCursor: number;
  hannWindow: Float32Array;
  fft: FFT;
  freqComplexBuffer: any;
  freqComplexBufferShifted: any;
  timeComplexBuffer: any;
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

  constructor(options: PhaseVocoderNodeOptions) {
    options.processorOptions = {
      blockSize: BUFFERED_BLOCK_SIZE,
    };
    super(options);

    this.fftSize = this.blockSize;
    this.timeCursor = 0;

    this.hannWindow = genHannWindow(this.blockSize);

    // prepare FFT and pre-allocate buffers
    this.fft = new FFT(this.fftSize);
    this.freqComplexBuffer = this.fft.createComplexArray() as Float32Array[];
    this.freqComplexBufferShifted =
      this.fft.createComplexArray() as Float32Array[];
    this.timeComplexBuffer = this.fft.createComplexArray();
    this.magnitudes = new Float32Array(this.fftSize / 2 + 1);
    this.peakIndexes = new Int32Array(this.magnitudes.length);
    this.nbPeaks = 0;
  }

  processOLA(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: AudioParamMap
  ) {
    // @ts-ignore
    const pitchFactor =
      parameters.pitchFactor[parameters.pitchFactor.length - 1];

    for (let i = 0; i < this.nbInputs; i++) {
      for (let j = 0; j < inputs[i].length; j++) {
        var input = inputs[i][j];
        var output = outputs[i][j];

        this.applyHannWindow(input);

        this.fft.realTransform(this.freqComplexBuffer, input);

        this.computeMagnitudes();
        this.findPeaks();
        this.shiftPeaks(pitchFactor);

        this.fft.completeSpectrum(this.freqComplexBufferShifted);
        this.fft.inverseTransform(
          this.timeComplexBuffer,
          this.freqComplexBufferShifted
        );
        this.fft.fromComplexArray(this.timeComplexBuffer, output);

        this.applyHannWindow(output);
      }
    }

    this.timeCursor += this.hopSize;
    return true;
  }

  private applyHannWindow(input: Float32Array) {
    for (let i = 0; i < this.blockSize; i++) {
      input[i] *= this.hannWindow[i];
    }
  }

  private computeMagnitudes() {
    for (let i = 0, j = 0; i < this.magnitudes.length; i++, j += 2) {
      const real = this.freqComplexBuffer[j];
      const imag = this.freqComplexBuffer[j + 1];
      this.magnitudes[i] = real ** 2 + imag ** 2;
    }
  }

  private findPeaks() {
    this.nbPeaks = 0;
    for (let i = 2, end = this.magnitudes.length - 2; i < end; i++) {
      const mag = this.magnitudes[i];

      if (
        this.magnitudes[i - 1] >= mag ||
        this.magnitudes[i - 2] >= mag ||
        this.magnitudes[i + 1] >= mag ||
        this.magnitudes[i + 2] >= mag
      ) {
        continue;
      }

      this.peakIndexes[this.nbPeaks++] = i;
    }
  }

  private shiftPeaks(pitchFactor: number) {
    this.freqComplexBufferShifted.fill(0);

    for (let i = 0; i < this.nbPeaks; i++) {
      const peakIndex = this.peakIndexes[i];
      const peakIndexShifted = Math.round(peakIndex * pitchFactor);

      if (peakIndexShifted > this.magnitudes.length) {
        break;
      }

      let startIndex =
        i > 0
          ? peakIndex - Math.floor((peakIndex - this.peakIndexes[i - 1]) / 2)
          : 0;
      let endIndex =
        i < this.nbPeaks - 1
          ? peakIndex + Math.ceil((this.peakIndexes[i + 1] - peakIndex) / 2)
          : this.fftSize;

      for (let j = startIndex - peakIndex; j < endIndex - peakIndex; j++) {
        const binIndex = peakIndex + j;
        const binIndexShifted = peakIndexShifted + j;

        if (binIndexShifted >= this.magnitudes.length) {
          break;
        }

        const omegaDelta =
          (2 * Math.PI * (binIndexShifted - binIndex)) / this.fftSize;
        const phaseShiftReal = Math.cos(omegaDelta * this.timeCursor);
        const phaseShiftImag = Math.sin(omegaDelta * this.timeCursor);

        const indexReal = binIndex * 2;
        const indexImag = indexReal + 1;
        const valueReal = this.freqComplexBuffer[indexReal];
        const valueImag = this.freqComplexBuffer[indexImag];

        const valueShiftedReal =
          valueReal * phaseShiftReal - valueImag * phaseShiftImag;
        const valueShiftedImag =
          valueReal * phaseShiftImag + valueImag * phaseShiftReal;

        const indexShiftedReal = binIndexShifted * 2;
        const indexShiftedImag = indexShiftedReal + 1;
        this.freqComplexBufferShifted[indexShiftedReal] += valueShiftedReal;
        this.freqComplexBufferShifted[indexShiftedImag] += valueShiftedImag;
      }
    }
  }
}

// @ts-ignore
registerProcessor("phase-vocoder", PhaseVocoderProcessor);
console.log("PhaseVocoderProcessor registered");
