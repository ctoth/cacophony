export interface PcmStreamEngineOptions {
  capacityFrames: number;
  channelCount: number;
  latencyFrames: number;
}

export interface PcmStreamProcessResult {
  consumedFrames: number;
  ended: boolean;
  underrun: boolean;
}

class PcmRingBuffer {
  private readonly channels: Float32Array[];
  private readIndex = 0;
  private writeIndex = 0;
  private size = 0;

  constructor(
    readonly capacityFrames: number,
    readonly channelCount: number,
  ) {
    if (!Number.isInteger(capacityFrames) || capacityFrames <= 0) {
      throw new RangeError("PCM ring-buffer capacity must be a positive integer");
    }
    if (!Number.isInteger(channelCount) || channelCount <= 0) {
      throw new RangeError("PCM channel count must be a positive integer");
    }
    this.channels = Array.from({ length: channelCount }, () => new Float32Array(capacityFrames));
  }

  get bufferedFrames(): number {
    return this.size;
  }

  writeInterleaved(samples: Float32Array): boolean {
    if (samples.length % this.channelCount !== 0) {
      throw new RangeError(`Interleaved PCM length must be divisible by channelCount (${this.channelCount})`);
    }
    const frameCount = samples.length / this.channelCount;
    if (frameCount > this.capacityFrames - this.size) {
      return false;
    }

    for (let frame = 0; frame < frameCount; frame++) {
      for (let channel = 0; channel < this.channelCount; channel++) {
        this.channels[channel][this.writeIndex] = samples[frame * this.channelCount + channel];
      }
      this.writeIndex = (this.writeIndex + 1) % this.capacityFrames;
    }
    this.size += frameCount;
    return true;
  }

  read(output: Float32Array[]): number {
    const frameCount = Math.min(this.size, output[0]?.length ?? 0);
    for (let frame = 0; frame < frameCount; frame++) {
      for (let channel = 0; channel < Math.min(this.channelCount, output.length); channel++) {
        output[channel][frame] = this.channels[channel][this.readIndex];
      }
      this.readIndex = (this.readIndex + 1) % this.capacityFrames;
    }
    this.size -= frameCount;
    return frameCount;
  }

  clear(): void {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.size = 0;
  }
}

/**
 * Context-free state machine for the PCM stream worklet.
 *
 * The worklet shell owns MessagePort plumbing; this class owns the fixed-size
 * ring buffer, latency gate, pause/resume position, underrun episodes, and
 * terminal end-of-input behavior.
 */
export class PcmStreamEngine {
  private readonly ring: PcmRingBuffer;
  private readonly latencyFrames: number;
  private playing = false;
  private started = false;
  private inputEnded = false;
  private underrunActive = false;
  private endedReported = false;

  constructor(options: PcmStreamEngineOptions) {
    if (!Number.isInteger(options.latencyFrames) || options.latencyFrames < 0) {
      throw new RangeError("PCM latency must be a non-negative integer number of frames");
    }
    if (options.latencyFrames > options.capacityFrames) {
      throw new RangeError("PCM latency cannot exceed the ring-buffer capacity");
    }
    this.ring = new PcmRingBuffer(options.capacityFrames, options.channelCount);
    this.latencyFrames = options.latencyFrames;
  }

  get bufferedFrames(): number {
    return this.ring.bufferedFrames;
  }

  writeInterleaved(samples: Float32Array): boolean {
    if (this.inputEnded) {
      throw new Error("Cannot write PCM after end()");
    }
    const accepted = this.ring.writeInterleaved(samples);
    if (accepted) {
      this.underrunActive = false;
    }
    return accepted;
  }

  play(): void {
    if (!this.endedReported) {
      this.playing = true;
    }
  }

  pause(): void {
    this.playing = false;
  }

  stop(): void {
    this.ring.clear();
    this.playing = false;
    this.started = false;
    this.inputEnded = false;
    this.underrunActive = false;
    this.endedReported = false;
  }

  end(): void {
    this.inputEnded = true;
  }

  process(output: Float32Array[]): PcmStreamProcessResult {
    for (const channel of output) {
      channel.fill(0);
    }
    const result: PcmStreamProcessResult = {
      consumedFrames: 0,
      ended: false,
      underrun: false,
    };
    const quantumFrames = output[0]?.length ?? 0;
    if (!this.playing || quantumFrames === 0) {
      return result;
    }

    if (!this.started) {
      if (this.ring.bufferedFrames < this.latencyFrames && !this.inputEnded) {
        return result;
      }
      this.started = true;
    }

    result.consumedFrames = this.ring.read(output);
    if (this.inputEnded && this.ring.bufferedFrames === 0) {
      this.playing = false;
      if (!this.endedReported) {
        this.endedReported = true;
        result.ended = true;
      }
      return result;
    }

    if (result.consumedFrames < quantumFrames && this.ring.bufferedFrames === 0 && !this.underrunActive) {
      this.underrunActive = true;
      result.underrun = true;
    }
    return result;
  }
}
