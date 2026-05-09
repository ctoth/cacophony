import { StereoToFoaUpmixer } from "./stereo-to-bformat-core";

const WORKLET_LOG_PREFIX = "[cacophony/worklet:stereo-to-bformat]";

export class StereoToBFormatProcessor extends AudioWorkletProcessor {
  private framesProcessed = 0;
  private framesShortInput = 0;
  private lastReportFrame = 0;
  private readonly upmixer = new StereoToFoaUpmixer(sampleRate);

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length < 2 || !output || output.length < 4) {
      this.framesShortInput++;
      this.framesProcessed++;
      this.maybeReport(input?.length ?? 0, "short-input", input, output);
      return true;
    }

    this.upmixer.process(input[0], input[1], output[0], output[1], output[2], output[3]);
    this.framesProcessed++;
    this.maybeReport(input.length, "ok", input, output);
    return true;
  }

  private maybeReport(
    channels: number,
    kind: "ok" | "short-input",
    input?: Float32Array[],
    output?: Float32Array[],
  ): void {
    if (this.framesProcessed - this.lastReportFrame < 750) return;
    this.lastReportFrame = this.framesProcessed;
    let stats = "";
    if (input && input.length >= 2 && output && output.length >= 4) {
      const peak = (a: Float32Array): number => {
        let m = 0;
        for (let i = 0; i < a.length; i++) {
          const v = Math.abs(a[i]);
          if (v > m) m = v;
        }
        return m;
      };
      stats =
        ` peakL=${peak(input[0]).toFixed(4)}` +
        ` peakR=${peak(input[1]).toFixed(4)}` +
        ` peakW=${peak(output[0]).toFixed(4)}` +
        ` peakY=${peak(output[1]).toFixed(4)}` +
        ` peakZ=${peak(output[2]).toFixed(4)}` +
        ` peakX=${peak(output[3]).toFixed(4)}`;
    }
    console.info(
      `${WORKLET_LOG_PREFIX} process tick framesTotal=${this.framesProcessed} shortInput=${this.framesShortInput} channelsThisTick=${channels} kind=${kind}${stats}`,
    );
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
