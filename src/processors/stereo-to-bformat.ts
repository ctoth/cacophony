import { encodeStereoToBFormat } from "./stereo-to-bformat-core";

export class StereoToBFormatProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length < 2 || !output || output.length < 4) {
      return true;
    }

    encodeStereoToBFormat(input[0], input[1], output[0], output[1], output[2], output[3]);
    return true;
  }
}

registerProcessor("stereo-to-bformat", StereoToBFormatProcessor);
