import { PHASER_DEFAULTS, type PhaserParams, PhaserProcessor } from "./phaser-core";

/*
 * Phaser AudioWorklet shell — thin AudioWorkletProcessor that delegates ALL DSP
 * math to the context-free PhaserProcessor in phaser-core.ts. Mirrors the
 * modulated-delay.ts / dynamics.ts core/shell split: this file owns only the
 * worklet plumbing (parameterDescriptors, process(), the registerProcessor
 * call); the algorithm lives in the unit-tested core.
 *
 * Algorithm: classic MXR/Univibe-style cascade of first-order allpass sections
 * at a common LFO-swept break frequency, summed additively with the dry signal
 * (Smith STAN-M-21; PASP §8.9). See phaser-core.ts header for the section
 * transfer function, the bilinear break-frequency map, the additive-notch
 * rationale and the multiplicative LFO sweep.
 */

const WORKLET_LOG_PREFIX = "[cacophony/worklet:phaser]";

export class PhaserWorkletProcessor extends AudioWorkletProcessor {
  // One stateful core per channel so each channel keeps its own allpass section
  // states, feedback memory and LFO phase across process() blocks. Each
  // channel's LFO is seeded in quadrature (ch * pi/2) so a stereo pair gets the
  // dynamic stereo field Dattorro describes (p.776).
  private cores: PhaserProcessor[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    // Default VALUES come from PHASER_DEFAULTS (phaser-core.ts) — the single
    // source of truth shared with the core tests. Ranges live here. `stages` is
    // a count (rounded to an int in the core); |feedback| <= 0.95 keeps the
    // regeneration loop bounded.
    return [
      ["frequency", PHASER_DEFAULTS.frequency, 20, 10000, "k-rate"],
      ["rate", PHASER_DEFAULTS.rate, 0, 20, "k-rate"],
      ["depth", PHASER_DEFAULTS.depth, 0, 4, "k-rate"],
      ["stages", PHASER_DEFAULTS.stages, 2, 12, "k-rate"],
      ["feedback", PHASER_DEFAULTS.feedback, -0.95, 0.95, "k-rate"],
      ["mix", PHASER_DEFAULTS.mix, 0, 1, "k-rate"],
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
    const params: PhaserParams = {
      frequency: parameters.frequency[0],
      rate: parameters.rate[0],
      depth: parameters.depth[0],
      stages: parameters.stages[0],
      feedback: parameters.feedback[0],
      mix: parameters.mix[0],
    };

    const channelCount = Math.min(input.length, output.length);
    for (let ch = 0; ch < channelCount; ch++) {
      if (!this.cores[ch]) {
        // Seed the LFO 90 deg apart per channel for the quadrature stereo field
        // (Dattorro p.776).
        this.cores[ch] = new PhaserProcessor(sampleRate, (ch * Math.PI) / 2);
      }
      this.cores[ch].process(input[ch], output[ch], params);
    }
    return true;
  }
}

console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
try {
  registerProcessor("phaser", PhaserWorkletProcessor);
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
} catch (error) {
  console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
  throw error;
}
