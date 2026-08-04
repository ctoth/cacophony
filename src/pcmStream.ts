import { BasePlayback } from "./basePlayback";
import type { BaseSound, Cacophony, LoopCount, PanType, SoundType, StreamCapabilities } from "./cacophony";
import type { AudioNode, AudioParam, AudioWorkletNode, BaseContext, BiquadFilterNode, GainNode } from "./context";
import { TypedEventEmitter } from "./eventEmitter";
import { RoutableSource } from "./routableSource";

export type PcmStreamState = "idle" | "playing" | "paused" | "stopped" | "ended";

export interface PcmStreamBufferEvent {
  bufferedDuration: number;
}

export type PcmStreamEvents = {
  stateChange: PcmStreamState;
  underrun: PcmStreamBufferEvent;
  drain: PcmStreamBufferEvent;
  ended: undefined;
  error: unknown;
};

export interface PcmStreamPullSource {
  seek(time: number): void;
  cleanup(): void;
}

export interface PcmStreamSoundOptions {
  /** Number of interleaved channels in every {@link PcmStreamSound.write} call. @default 1 */
  channelCount?: number;
  /** Fixed ring-buffer capacity in seconds. @default 1 */
  bufferDuration?: number;
  /** PCM that must be buffered before initial consumption starts, in seconds. @default 0.05 */
  latency?: number;
  /** Spatial panner implementation used by the playback. @default "HRTF" */
  panType?: PanType;
  /** Aborting tears down the worklet and routing graph. */
  signal?: AbortSignal;
}

type PcmWorkletMessage =
  | { type: "consumed"; frames: number }
  | { type: "underrun" }
  | { type: "ended" }
  | { type: "overflow" };

export class PcmStreamPlayback extends BasePlayback {
  public declare origin: PcmStreamSound;
  public declare source?: AudioWorkletNode;

  constructor(
    origin: PcmStreamSound,
    source: AudioWorkletNode,
    gainNode: GainNode,
    context: BaseContext,
    outputNode: AudioNode,
    panType: PanType,
  ) {
    super(origin);
    this.source = source;
    this.setPanType(panType, context);
    this.setGainNode(gainNode);
    this.setEffectChainEndpoints(this.source, this.panner!);
    this.panner!.connect(this.gainNode!);
    this.gainNode!.connect(outputNode);
  }

  get duration(): number {
    return Number.POSITIVE_INFINITY;
  }

  play(): [this] {
    if (!this.source) {
      throw new Error("Cannot play a PCM stream that has been cleaned up");
    }
    if (this.isPlaying) {
      return [this];
    }
    const isResume = this.isPaused;
    this.source.port.postMessage({ type: "play" });
    this.emitPlayStarted(isResume);
    return [this];
  }

  pause(): void {
    if (!this.source || !this.isPlaying) {
      return;
    }
    this.source.port.postMessage({ type: "pause" });
    this.emitPaused();
  }

  stop(): void {
    if (!this.source) {
      return;
    }
    const shouldEmitStop = this.isPlaying || this.isPaused;
    this.source.port.postMessage({ type: "stop" });
    if (shouldEmitStop) {
      this.emitStopped();
    } else {
      this.markStopped();
    }
  }

  _handleEnded(): void {
    if (!this.source) {
      return;
    }
    this.markStopped();
    this.emit("ended", undefined);
  }

  get playbackRate(): number {
    return 1;
  }

  set playbackRate(_rate: number) {}

  addFilter(filter: BiquadFilterNode): void {
    if (!this.source) {
      throw new Error("Cannot add a filter to a PCM stream that has been cleaned up");
    }
    super.addFilter(filter);
  }

  removeFilter(filter: BiquadFilterNode): void {
    if (!this.source) {
      throw new Error("Cannot remove a filter from a PCM stream that has been cleaned up");
    }
    super.removeFilter(filter);
  }

  get outputNode(): GainNode {
    if (!this.gainNode) {
      throw new Error("Cannot access output node of a PCM stream that has been cleaned up");
    }
    return this.gainNode;
  }

  connect(destination: AudioNode | AudioParam): AudioNode {
    return this.outputNode.connect(destination as AudioNode);
  }

  disconnect(destination?: AudioNode | AudioParam): void {
    if (destination) {
      this.outputNode.disconnect(destination as AudioNode);
    } else {
      this.outputNode.disconnect();
    }
  }

  cleanup(): void {
    if (!this.source) {
      return;
    }
    this.markStopped();
    this.source.disconnect();
    this.source = undefined;
    super.cleanup();
  }
}

export class PcmStreamSound extends RoutableSource implements BaseSound {
  public declare playbacks: PcmStreamPlayback[];
  public soundType?: SoundType;
  public streamCapabilities?: StreamCapabilities;
  protected context: BaseContext;
  protected globalGainNode: GainNode;
  private readonly workletNode: AudioWorkletNode;
  private readonly channelCount: number;
  private readonly capacityFrames: number;
  private readonly panType: PanType;
  private readonly eventEmitter = new TypedEventEmitter<PcmStreamEvents>();
  private readonly signal?: AbortSignal;
  private bufferedFrames = 0;
  private backpressured = false;
  private inputEnded = false;
  private disposed = false;
  private state: PcmStreamState = "idle";
  private pullSource?: PcmStreamPullSource;

  private readonly handleWorkletMessage = (event: MessageEvent<PcmWorkletMessage>): void => {
    switch (event.data.type) {
      case "consumed":
        this.bufferedFrames = Math.max(0, this.bufferedFrames - event.data.frames);
        if (this.backpressured && this.bufferedFrames < this.capacityFrames) {
          this.backpressured = false;
          this.emit("drain", { bufferedDuration: this.bufferedDuration });
        }
        break;
      case "underrun":
        this.emit("underrun", { bufferedDuration: this.bufferedDuration });
        break;
      case "ended":
        this.bufferedFrames = 0;
        this.playbacks.forEach((playback) => playback._handleEnded());
        this.setState("ended");
        this.emit("ended", undefined);
        break;
      case "overflow":
        this.backpressured = true;
        break;
    }
  };

  private readonly handleAbort = (): void => {
    this.cleanup();
  };

  constructor(
    workletNode: AudioWorkletNode,
    context: BaseContext,
    globalGainNode: GainNode,
    options: PcmStreamSoundOptions & {
      channelCount: number;
      bufferDuration: number;
      latency: number;
    },
    private readonly _cacophony?: Cacophony,
  ) {
    super();
    this.workletNode = workletNode;
    this.context = context;
    this.globalGainNode = globalGainNode;
    this.channelCount = options.channelCount;
    this.capacityFrames = Math.ceil(context.sampleRate * options.bufferDuration);
    this.panType = options.panType ?? "HRTF";
    this.signal = options.signal;
    this.workletNode.port.addEventListener("message", this.handleWorkletMessage as EventListener);
    this.workletNode.port.start?.();
    this.signal?.addEventListener("abort", this.handleAbort, { once: true });
  }

  get cacophony(): Cacophony | undefined {
    return this._cacophony;
  }

  get bufferedDuration(): number {
    return this.bufferedFrames / this.context.sampleRate;
  }

  get inputChannelCount(): number {
    return this.channelCount;
  }

  on<K extends keyof PcmStreamEvents>(event: K, listener: (data: PcmStreamEvents[K]) => void): () => void {
    return this.eventEmitter.on(event, listener);
  }

  off<K extends keyof PcmStreamEvents>(event: K, listener: (data: PcmStreamEvents[K]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  private emit<K extends keyof PcmStreamEvents>(event: K, data: PcmStreamEvents[K]): void {
    this.eventEmitter.emit(event, data);
  }

  private setState(state: PcmStreamState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.emit("stateChange", state);
  }

  attachPullSource(source: PcmStreamPullSource, capabilities: StreamCapabilities): void {
    if (this.disposed || this.pullSource) {
      throw new Error("Cannot attach a pull source to this PCM stream");
    }
    this.pullSource = source;
    this.soundType = "streaming";
    this.streamCapabilities = capabilities;
  }

  handlePullError(error: unknown): void {
    if (!this.disposed) {
      this.emit("error", error);
    }
  }

  /**
   * Enqueue PCM at the context's sample rate.
   *
   * Samples are interleaved according to `channelCount`. `false` means the
   * fixed ring buffer is full (or this accepted write filled it); wait for
   * `drain` before retrying a rejected chunk.
   */
  write(samples: Float32Array): boolean {
    if (this.disposed) {
      throw new Error("Cannot write to a PCM stream that has been cleaned up");
    }
    if (this.inputEnded) {
      throw new Error("Cannot write PCM after end()");
    }
    if (!(samples instanceof Float32Array)) {
      throw new TypeError("PCM writes require an interleaved Float32Array");
    }
    if (samples.length % this.channelCount !== 0) {
      throw new RangeError(`Interleaved PCM length must be divisible by channelCount (${this.channelCount})`);
    }
    const frameCount = samples.length / this.channelCount;
    if (frameCount > this.capacityFrames) {
      throw new RangeError("PCM chunk is larger than the configured ring buffer");
    }
    if (this.bufferedFrames + frameCount > this.capacityFrames) {
      this.backpressured = true;
      return false;
    }

    this.workletNode.port.postMessage({
      type: "write",
      samples: samples.slice(),
    });
    this.bufferedFrames += frameCount;
    if (this.bufferedFrames === this.capacityFrames) {
      this.backpressured = true;
      return false;
    }
    return true;
  }

  end(): void {
    if (this.disposed || this.inputEnded) {
      return;
    }
    this.inputEnded = true;
    this.workletNode.port.postMessage({ type: "end" });
  }

  preplay(): PcmStreamPlayback[] {
    if (this.disposed) {
      throw new Error("Cannot play a PCM stream that has been cleaned up");
    }
    if (this.playbacks[0]) {
      return [this.playbacks[0]];
    }
    const playback = new PcmStreamPlayback(
      this,
      this.workletNode,
      this.context.createGain(),
      this.context,
      this._resolveRouteTargetNode(),
      this.panType,
    );
    this._preparePlayback(playback);
    playback.volume = this.volume;
    if (this.panType === "HRTF") {
      playback.threeDOptions = this.threeDOptions;
      playback.position = this.position;
    } else {
      playback.stereoPan = this.stereoPan;
    }
    this.playbacks.push(playback);
    return [playback];
  }

  play(): PcmStreamPlayback[] {
    if (this.state === "ended") {
      throw new Error("Cannot play a PCM stream after it has ended");
    }
    const playbacks = this.preplay();
    playbacks.forEach((playback) => playback.play());
    this.setState("playing");
    return playbacks;
  }

  pause(): void {
    if (this.state !== "playing") {
      return;
    }
    this.playbacks.forEach((playback) => playback.pause());
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") {
      return;
    }
    this.playbacks.forEach((playback) => playback.play());
    this.setState("playing");
  }

  stop(): void {
    if (this.disposed) {
      return;
    }
    const hadPlayback = this.playbacks.length > 0;
    super.stop();
    if (!hadPlayback) {
      this.workletNode.port.postMessage({ type: "stop" });
    }
    this.bufferedFrames = 0;
    this.backpressured = false;
    this.inputEnded = false;
    this.setState("stopped");
  }

  seek(time: number): void {
    if (!this.pullSource) {
      throw new Error("PCM streams do not support seeking");
    }
    this.pullSource.seek(time);
  }

  loop(_loopCount?: LoopCount): LoopCount {
    throw new Error("PCM streams do not support looping");
  }

  get playbackRate(): number {
    return 1;
  }

  set playbackRate(_rate: number) {}

  cleanup(): void {
    if (this.disposed) {
      return;
    }
    this.stop();
    this.disposed = true;
    this.pullSource?.cleanup();
    this.pullSource = undefined;
    this.signal?.removeEventListener("abort", this.handleAbort);
    this.workletNode.port.removeEventListener("message", this.handleWorkletMessage as EventListener);
    this.workletNode.disconnect();
    this.eventEmitter.removeAllListeners();
    super.cleanup();
  }
}
