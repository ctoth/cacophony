import { DYNAMICS_DEFAULTS, type DynamicsParams, DynamicsProcessor } from "./dynamics-core";

/*
 * Dynamics AudioWorklet shell — thin AudioWorkletProcessor that delegates ALL
 * DSP math to the context-free DynamicsProcessor in dynamics-core.ts. Mirrors
 * the dattorro-reverb.ts / stereo-to-bformat.ts core/shell split: this file
 * owns only the worklet plumbing (parameterDescriptors, process(), the
 * registerProcessor call); the algorithm lives in the unit-tested core.
 *
 * Algorithm: feed-forward dynamic range compressor/limiter/expander/gate per
 * Giannoulis, Massberg & Reiss 2012 (see dynamics-core.ts header for the full
 * citation and per-equation comments).
 */

const WORKLET_LOG_PREFIX = "[cacophony/worklet:dynamics]";

/**
 * Ratio sentinel: the worklet's AudioParam cannot carry +Infinity, so a
 * limiter is expressed as a very large finite ratio here and treated as
 * "->infinity" by the gain computer (slope effectively 0 above threshold).
 * createLimiter() in cacophony.ts sets the ratio to this value.
 */
const LIMITER_RATIO = 1000;

export class DynamicsWorkletProcessor extends AudioWorkletProcessor {
  // One stateful core per channel so each channel keeps its own ballistics
  // envelope (eq.16 detector state) across process() blocks.
  private cores: DynamicsProcessor[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    // Default VALUES come from DYNAMICS_DEFAULTS (dynamics-core.ts) — the single
    // source of truth shared with the gate regression tests. Ranges live here
    // and cover compressor (ratio >= 1), limiter (ratio -> large), and downward
    // expander/gate (ratio < 1) from one parameter set.
    return [
      ["threshold", DYNAMICS_DEFAULTS.threshold, -100, 0, "k-rate"],
      ["ratio", DYNAMICS_DEFAULTS.ratio, 0.05, LIMITER_RATIO, "k-rate"],
      ["knee", DYNAMICS_DEFAULTS.knee, 0, 40, "k-rate"],
      ["attack", DYNAMICS_DEFAULTS.attack, 0, 1, "k-rate"],
      ["release", DYNAMICS_DEFAULTS.release, 0, 5, "k-rate"],
      ["makeup", DYNAMICS_DEFAULTS.makeup, -24, 24, "k-rate"],
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

    // k-rate params: take the first (constant-over-block) value. A ratio at or
    // above the limiter sentinel is mapped to +Infinity so the core's gain
    // computer uses the exact limiter slope (0) rather than 1/LIMITER_RATIO.
    const ratioParam = parameters.ratio[0];
    const params: DynamicsParams = {
      threshold: parameters.threshold[0],
      ratio: ratioParam >= LIMITER_RATIO ? Number.POSITIVE_INFINITY : ratioParam,
      knee: parameters.knee[0],
      attack: parameters.attack[0],
      release: parameters.release[0],
      makeup: parameters.makeup[0],
    };

    const channelCount = Math.min(input.length, output.length);
    for (let ch = 0; ch < channelCount; ch++) {
      if (!this.cores[ch]) {
        this.cores[ch] = new DynamicsProcessor(sampleRate);
      }
      this.cores[ch].process(input[ch], output[ch], params);
    }
    return true;
  }
}

console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
try {
  registerProcessor("dynamics", DynamicsWorkletProcessor);
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
} catch (error) {
  console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
  throw error;
}
