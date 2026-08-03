import { FrequencyShifterCore } from "./frequency-shifter-core";

export class FrequencyShifterWorkletProcessor extends AudioWorkletProcessor {
  private cores: FrequencyShifterCore[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: "frequency", defaultValue: 100, minValue: -24000, maxValue: 24000, automationRate: "k-rate" },
      { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const frequency = parameters.frequency[parameters.frequency.length - 1];
    const mix = parameters.mix[parameters.mix.length - 1];
    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] ?? input[0];
      if (!source) {
        output[channel].fill(0);
        continue;
      }
      const core = (this.cores[channel] ??= new FrequencyShifterCore(sampleRate));
      core.process(source, output[channel], { frequency, mix });
    }
    return true;
  }
}

registerProcessor("frequency-shifter", FrequencyShifterWorkletProcessor);
