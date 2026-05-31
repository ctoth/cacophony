import { type FdnReverbParams, FdnReverbProcessor } from "./fdn-reverb-core";

/*
 * FDN reverb AudioWorklet shell — a thin AudioWorkletProcessor that delegates
 * ALL DSP math to the context-free FdnReverbProcessor in fdn-reverb-core.ts.
 * Mirrors the dattorro-reverb.ts / dynamics.ts core/shell split: this file owns
 * only the worklet plumbing (parameterDescriptors, process(), the
 * registerProcessor call); the algorithm lives in the unit-tested core.
 *
 * Algorithm: a Feedback Delay Network reverberator with a lossless (degree-0
 * paraunitary Hadamard) feedback matrix (Schlecht & Habets 2019, "Scattering in
 * Feedback Delay Networks"), per-delay-line absorption filters setting T60 (Jot
 * & Chaigne 1991), and multiplication-free velvet-noise input diffusion
 * (Fagerström, Alary, Schlecht & Välimäki 2020, "Velvet-Noise Feedback Delay
 * Network"). See fdn-reverb-core.ts for the full citation and per-equation
 * comments.
 */

const WORKLET_LOG_PREFIX = "[cacophony/worklet:fdn-reverb]";

export class FdnReverbWorkletProcessor extends AudioWorkletProcessor {
  // One stateful core per channel so each channel keeps its own delay-line and
  // absorption-filter state across process() blocks.
  private cores: FdnReverbProcessor[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    // Defaults: a moderate, natural room. decayTime in seconds (T60); preDelay
    // in seconds; damping/diffusion/mix normalized to [0,1].
    return [
      ["decayTime", 1.5, 0.001, 20, "k-rate"],
      ["preDelay", 0, 0, 1, "k-rate"],
      ["damping", 0.3, 0, 1, "k-rate"],
      ["diffusion", 0.5, 0, 1, "k-rate"],
      ["mix", 0.3, 0, 1, "k-rate"],
    ].map(([name, defaultValue, minValue, maxValue, automationRate]) => ({
      name: name as string,
      defaultValue: defaultValue as number,
      minValue: minValue as number,
      maxValue: maxValue as number,
      automationRate: automationRate as AutomationRate,
    }));
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    // k-rate params: take the first (constant-over-block) value.
    const params: FdnReverbParams = {
      decayTime: parameters.decayTime[0],
      preDelay: parameters.preDelay[0],
      damping: parameters.damping[0],
      diffusion: parameters.diffusion[0],
      mix: parameters.mix[0],
    };

    const channelCount = Math.min(input.length, output.length);
    for (let ch = 0; ch < channelCount; ch++) {
      if (!this.cores[ch]) {
        this.cores[ch] = new FdnReverbProcessor(sampleRate);
      }
      this.cores[ch].process(input[ch], output[ch], params);
    }
    return true;
  }
}

console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
try {
  registerProcessor("fdn-reverb", FdnReverbWorkletProcessor);
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
} catch (error) {
  console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
  throw error;
}
