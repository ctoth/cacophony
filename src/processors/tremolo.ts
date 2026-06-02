import { type ShapeMode, TREMOLO_DEFAULTS, type TremoloParams, TremoloProcessor } from "./tremolo-core";

/*
 * Tremolo AudioWorklet shell — thin AudioWorkletProcessor that delegates ALL DSP
 * math to the context-free TremoloProcessor in tremolo-core.ts. Mirrors the
 * modulated-delay.ts / phaser.ts core/shell split: this file owns only the
 * worklet plumbing (parameterDescriptors, process(), the registerProcessor
 * call); the algorithm lives in the unit-tested core.
 *
 * Algorithm: LFO-driven amplitude modulation (a VCA swung by a low-frequency
 * oscillator). See tremolo-core.ts header for the AM gain law, its sideband
 * structure, the honest paper anchoring (AM theory + Dattorro 1997 p.776
 * quadrature LFO + Mitcheltree et al. DAFx23 LFO framing), and the per-sample
 * (zipper-free) gain.
 */

const WORKLET_LOG_PREFIX = "[cacophony/worklet:tremolo]";

/**
 * Shape selection rides on an AudioParam (which can only carry numbers), so the
 * "shape" param is an enum index: 0 = sine, 1 = triangle, 2 = square.
 */
const SHAPE_BY_INDEX: ShapeMode[] = ["sine", "triangle", "square"];

function shapeFromIndex(index: number): ShapeMode {
  const i = Math.round(index);
  return SHAPE_BY_INDEX[i] ?? "sine";
}

export class TremoloWorkletProcessor extends AudioWorkletProcessor {
  // One stateful core per channel so each channel keeps its own LFO phase across
  // process() blocks. Each core is constructed with its channelIndex so the
  // (live) stereoPhase param can pan the channels apart (Dattorro p.776).
  private cores: TremoloProcessor[] = [];

  static get parameterDescriptors(): AudioParamDescriptor[] {
    // Default VALUES come from TREMOLO_DEFAULTS (tremolo-core.ts) — the single
    // source of truth shared with the core tests. Ranges live here. `shape` is an
    // enum index (0=sine, 1=triangle, 2=square); stereoPhase is in degrees.
    return [
      ["rate", TREMOLO_DEFAULTS.rate, 0, 20, "k-rate"],
      ["depth", TREMOLO_DEFAULTS.depth, 0, 1, "k-rate"],
      ["shape", 0, 0, 2, "k-rate"],
      ["stereoPhase", TREMOLO_DEFAULTS.stereoPhase, 0, 180, "k-rate"],
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
    const params: TremoloParams = {
      rate: parameters.rate[0],
      depth: parameters.depth[0],
      shape: shapeFromIndex(parameters.shape[0]),
      stereoPhase: parameters.stereoPhase[0],
    };

    const channelCount = Math.min(input.length, output.length);
    for (let ch = 0; ch < channelCount; ch++) {
      if (!this.cores[ch]) {
        // Pass the channel index so stereoPhase offsets the per-channel LFO
        // live (quadrature/auto-pan stereo field, Dattorro p.776).
        this.cores[ch] = new TremoloProcessor(sampleRate, ch);
      }
      this.cores[ch].process(input[ch], output[ch], params);
    }
    return true;
  }
}

console.info(`${WORKLET_LOG_PREFIX} module evaluating`);
try {
  registerProcessor("tremolo", TremoloWorkletProcessor);
  console.info(`${WORKLET_LOG_PREFIX} registerProcessor complete`);
} catch (error) {
  console.error(`${WORKLET_LOG_PREFIX} registerProcessor failed`, error);
  throw error;
}
