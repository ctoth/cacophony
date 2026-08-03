import { StereoWidenerCore } from "./stereo-widener-core";

export class StereoWidenerWorkletProcessor extends AudioWorkletProcessor {
  private readonly core = new StereoWidenerCore(sampleRate);

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: "width", defaultValue: 0.65, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "decorrelation", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "transientProtection", defaultValue: 0.75, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (output.length < 2) return true;
    const leftInput = input[0];
    const rightInput = input[1] ?? leftInput;
    const leftOutput = output[0];
    const rightOutput = output[1];
    if (!leftInput || !rightInput) {
      leftOutput.fill(0);
      rightOutput.fill(0);
      return true;
    }
    const params = {
      width: parameters.width[parameters.width.length - 1],
      decorrelation: parameters.decorrelation[parameters.decorrelation.length - 1],
      transientProtection: parameters.transientProtection[parameters.transientProtection.length - 1],
    };
    for (let i = 0; i < leftOutput.length; i++) {
      const [left, right] = this.core.processSample(leftInput[i], rightInput[i], params);
      leftOutput[i] = left;
      rightOutput[i] = right;
    }
    return true;
  }
}

registerProcessor("stereo-widener", StereoWidenerWorkletProcessor);
