import { encodeStereoToBFormat } from "./stereo-to-bformat-core";

const WORKLET_LOG_PREFIX = "[cacophony/worklet:stereo-to-bformat]";

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

console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
try {
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor start`);
  registerProcessor("stereo-to-bformat", StereoToBFormatProcessor);
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
} catch (error) {
  console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
  throw error;
}
