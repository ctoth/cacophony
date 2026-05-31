import { WaveshaperProcessor, type WaveshaperParams, type WaveshaperShape } from "./waveshaper-core";

/*
 * Waveshaper AudioWorklet shell — thin AudioWorkletProcessor that delegates ALL
 * DSP math to the context-free WaveshaperProcessor in waveshaper-core.ts.
 * Mirrors the dynamics.ts / dattorro-reverb.ts core/shell split: this file owns
 * only the worklet plumbing (parameterDescriptors, process(), the
 * registerProcessor call); the algorithm lives in the unit-tested core.
 *
 * Algorithm: antialiased waveshaping / distortion via first-order Antiderivative
 * Antialiasing (ADAA), Parker, Zavalishin & Le Bivic 2016 (DAFx-16). See
 * waveshaper-core.ts header for eq.9 (the ADAA difference), eq.10 (the midpoint
 * singularity fallback), the F0 antiderivatives, and the inherent 0.5-sample
 * group delay.
 */

const WORKLET_LOG_PREFIX = "[cacophony/worklet:waveshaper]";

/**
 * Shape selection rides on an AudioParam (which can only carry numbers), so the
 * "shape" param is an enum index: 0 = hardclip (polynomial F0, Parker 2016
 * eq.25), 1 = tanh soft clip (F0 = log cosh, Parker 2016 eq.20).
 */
const SHAPE_BY_INDEX: WaveshaperShape[] = ["hardclip", "tanh"];

function shapeFromIndex(index: number): WaveshaperShape {
  const i = Math.round(index);
  return SHAPE_BY_INDEX[i] ?? "hardclip";
}

export class WaveshaperWorkletProcessor extends AudioWorkletProcessor {
  // One stateful ADAA core per channel so each channel keeps its own
  // x_{n-1} / F0(x_{n-1}) history (Parker 2016 eq.9) across process() blocks.
  private cores: WaveshaperProcessor[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    // drive: pre-gain into the nonlinearity (1 = unity, higher = more
    //   saturation/harmonics). shape: 0=hardclip, 1=tanh. mix: wet/dry (1=wet).
    // output: post gain. All k-rate (constant over the 128-sample block).
    return [
      ["drive", 1, 0, 100, "k-rate"],
      ["shape", 0, 0, 1, "k-rate"],
      ["mix", 1, 0, 1, "k-rate"],
      ["output", 1, 0, 4, "k-rate"],
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
    const params: WaveshaperParams = {
      drive: parameters.drive[0],
      shape: shapeFromIndex(parameters.shape[0]),
      mix: parameters.mix[0],
      output: parameters.output[0],
    };

    const channelCount = Math.min(input.length, output.length);
    for (let ch = 0; ch < channelCount; ch++) {
      if (!this.cores[ch]) {
        this.cores[ch] = new WaveshaperProcessor();
      }
      this.cores[ch].process(input[ch], output[ch], params);
    }
    return true;
  }
}

console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
try {
  registerProcessor("waveshaper", WaveshaperWorkletProcessor);
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
} catch (error) {
  console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
  throw error;
}
