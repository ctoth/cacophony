import { PcmStreamEngine, type PcmStreamEngineOptions } from "./pcm-stream-core";

type PcmStreamCommand =
  | { type: "write"; samples: Float32Array }
  | { type: "play" }
  | { type: "pause" }
  | { type: "stop" }
  | { type: "end" };

/**
 * AudioWorklet shell for push-based PCM playback.
 *
 * All buffering and playback state lives in the context-free
 * {@link PcmStreamEngine}; this class only translates MessagePort commands,
 * renders one Web Audio quantum, and reports consumption/state upstream.
 */
export class PcmStreamWorkletProcessor extends AudioWorkletProcessor {
  private readonly engine: PcmStreamEngine;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const processorOptions = (options?.processorOptions ?? {}) as Partial<PcmStreamEngineOptions>;
    this.engine = new PcmStreamEngine({
      capacityFrames: processorOptions.capacityFrames ?? sampleRate,
      channelCount: processorOptions.channelCount ?? 1,
      latencyFrames: processorOptions.latencyFrames ?? 0,
    });
    this.port.onmessage = (event: MessageEvent<PcmStreamCommand>) => {
      const command = event.data;
      switch (command.type) {
        case "write":
          if (!this.engine.writeInterleaved(command.samples)) {
            this.port.postMessage({ type: "overflow" });
          }
          break;
        case "play":
          this.engine.play();
          break;
        case "pause":
          this.engine.pause();
          break;
        case "stop":
          this.engine.stop();
          break;
        case "end":
          this.engine.end();
          break;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const result = this.engine.process(outputs[0] ?? []);
    if (result.consumedFrames > 0) {
      this.port.postMessage({ type: "consumed", frames: result.consumedFrames });
    }
    if (result.underrun) {
      this.port.postMessage({ type: "underrun" });
    }
    if (result.ended) {
      this.port.postMessage({ type: "ended" });
    }
    return true;
  }
}

registerProcessor("pcm-stream", PcmStreamWorkletProcessor);
