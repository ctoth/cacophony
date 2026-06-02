import {
  type InterpolationMode,
  MODULATED_DELAY_DEFAULTS,
  type ModulatedDelayParams,
  ModulatedDelayProcessor,
} from "./modulated-delay-core";

/*
 * Modulated-delay AudioWorklet shell — thin AudioWorkletProcessor that delegates
 * ALL DSP math to the context-free ModulatedDelayProcessor in
 * modulated-delay-core.ts. Mirrors the dynamics.ts / waveshaper.ts core/shell
 * split: this file owns only the worklet plumbing (parameterDescriptors,
 * process(), the registerProcessor call); the algorithm lives in the unit-tested
 * core.
 *
 * Algorithm: Dattorro's unified modulated-delay circuit (Fig. 36, JAES 1997)
 * driving delay/chorus/flanger/vibrato/doubling from blend/feedforward/feedback
 * knobs, with Lagrange FIR fractional-delay interpolation (Laakso 1996). See
 * modulated-delay-core.ts header for the transfer function, Table 6 presets, the
 * fixed-feedback-tap rationale, the sinusoidal LFO and the interpolation choice.
 */

const WORKLET_LOG_PREFIX = "[cacophony/worklet:modulated-delay]";

/**
 * Interpolation selection rides on an AudioParam (which can only carry numbers),
 * so the "interpolation" param is an enum index: 0 = cubic (4-tap Lagrange N=3,
 * the default), 1 = linear (2-tap Lagrange N=1). Both are FIR (Laakso 1996).
 */
const INTERPOLATION_BY_INDEX: InterpolationMode[] = ["cubic", "linear"];

function interpolationFromIndex(index: number): InterpolationMode {
  const i = Math.round(index);
  return INTERPOLATION_BY_INDEX[i] ?? "cubic";
}

export class ModulatedDelayWorkletProcessor extends AudioWorkletProcessor {
  // One stateful core per channel so each channel keeps its own delay line,
  // feedback recirculation and LFO phase across process() blocks. Each channel's
  // LFO is seeded in quadrature (ch * pi/2) so a stereo pair gets the dynamic
  // stereo field Dattorro describes (p.776).
  private cores: ModulatedDelayProcessor[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    // Default VALUES come from MODULATED_DELAY_DEFAULTS (modulated-delay-core.ts)
    // — the single source of truth shared with the core tests. Ranges live here
    // and bound the buffer sizing (delayTime <= MAX_DELAY_MS, depth <=
    // MAX_DEPTH_MS) and stability (|feedback| <= 0.9999999, Dattorro Table 6).
    return [
      ["delayTime", MODULATED_DELAY_DEFAULTS.delayTime, 0, 1000, "k-rate"],
      ["depth", MODULATED_DELAY_DEFAULTS.depth, 0, 50, "k-rate"],
      ["rate", MODULATED_DELAY_DEFAULTS.rate, 0, 20, "k-rate"],
      ["feedback", MODULATED_DELAY_DEFAULTS.feedback, -0.9999999, 0.9999999, "k-rate"],
      ["blend", MODULATED_DELAY_DEFAULTS.blend, 0, 1, "k-rate"],
      ["feedforward", MODULATED_DELAY_DEFAULTS.feedforward, 0, 1, "k-rate"],
      ["interpolation", 0, 0, 1, "k-rate"],
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
    const params: ModulatedDelayParams = {
      delayTime: parameters.delayTime[0],
      depth: parameters.depth[0],
      rate: parameters.rate[0],
      feedback: parameters.feedback[0],
      blend: parameters.blend[0],
      feedforward: parameters.feedforward[0],
      interpolation: interpolationFromIndex(parameters.interpolation[0]),
    };

    const channelCount = Math.min(input.length, output.length);
    for (let ch = 0; ch < channelCount; ch++) {
      if (!this.cores[ch]) {
        // Seed the LFO 90 deg apart per channel for the quadrature stereo field
        // (Dattorro p.776).
        this.cores[ch] = new ModulatedDelayProcessor(sampleRate, (ch * Math.PI) / 2);
      }
      this.cores[ch].process(input[ch], output[ch], params);
    }
    return true;
  }
}

console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
try {
  registerProcessor("modulated-delay", ModulatedDelayWorkletProcessor);
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
} catch (error) {
  console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
  throw error;
}
