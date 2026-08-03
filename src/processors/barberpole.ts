import { BarberpoleCore } from "./barberpole-core";

export class BarberpoleWorkletProcessor extends AudioWorkletProcessor {
  private cores: BarberpoleCore[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: "rate", defaultValue: 0.1, minValue: -2, maxValue: 2, automationRate: "k-rate" },
      { name: "stages", defaultValue: 32, minValue: 2, maxValue: 64, automationRate: "k-rate" },
      { name: "coefficient", defaultValue: -0.5, minValue: -0.95, maxValue: 0.95, automationRate: "k-rate" },
      { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const params = {
      rate: parameters.rate[parameters.rate.length - 1],
      stages: parameters.stages[parameters.stages.length - 1],
      coefficient: parameters.coefficient[parameters.coefficient.length - 1],
      mix: parameters.mix[parameters.mix.length - 1],
    };
    for (let channel = 0; channel < output.length; channel++) {
      const source = input[channel] ?? input[0];
      if (!source) output[channel].fill(0);
      else (this.cores[channel] ??= new BarberpoleCore(sampleRate)).process(source, output[channel], params);
    }
    return true;
  }
}

registerProcessor("barberpole", BarberpoleWorkletProcessor);
