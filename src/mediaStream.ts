import { BasePlayback } from "./basePlayback";
import type { BaseSound, Cacophony, LoopCount, PanType } from "./cacophony";
import { PlaybackContainer } from "./container";
import type {
  AudioNode,
  AudioParam,
  BaseContext,
  BiquadFilterNode,
  GainNode,
  MediaStreamAudioSourceNode,
} from "./context";
import { FilterManager } from "./filters";

export interface MediaStreamSoundOptions {
  panType?: PanType;
  stopTracksOnStop?: boolean;
}

export class MediaStreamPlayback extends BasePlayback {
  public declare origin: MediaStreamSound;
  private hasStarted: boolean = false;
  private stopTracksOnStop: boolean;

  constructor(
    origin: MediaStreamSound,
    source: MediaStreamAudioSourceNode,
    gainNode: GainNode,
    context: BaseContext,
    outputNode: AudioNode,
    panType: PanType,
    stopTracksOnStop: boolean,
  ) {
    super();
    this.origin = origin;
    this.stopTracksOnStop = stopTracksOnStop;
    this.source = source;
    this.setPanType(panType, context);
    this.setGainNode(gainNode);
    this.source.connect(this.panner!);
    this.panner!.connect(this.gainNode!);
    this.gainNode!.connect(outputNode);
    this.refreshFilters();
  }

  get duration(): number {
    return 0;
  }

  play(): [this] {
    if (!this.source) {
      throw new Error("Cannot play a media stream that has been cleaned up");
    }
    if (this._playing) {
      return [this];
    }
    this.source.mediaStream.getTracks().forEach((track) => (track.enabled = true));
    this.hasStarted = true;
    this._playing = true;
    this.emit("play", this);
    this.origin.cacophony?.emit("globalPlay", {
      source: this.origin,
      timestamp: Date.now(),
    });
    return [this];
  }

  pause(): void {
    if (!this.source || !this._playing) {
      return;
    }
    this.source.mediaStream.getTracks().forEach((track) => (track.enabled = false));
    this._playing = false;
    this.emit("pause", undefined);
    this.origin.cacophony?.emit("globalPause", {
      source: this.origin,
      timestamp: Date.now(),
    });
  }

  resume(): void {
    this.play();
  }

  stop(): void {
    if (!this.source) {
      throw new Error("Cannot stop a media stream that has been cleaned up");
    }
    const shouldEmitStop = this.hasStarted;
    if (this.stopTracksOnStop) {
      this.source.mediaStream.getTracks().forEach((track) => track.stop());
    }
    this.hasStarted = false;
    this._playing = false;
    if (shouldEmitStop) {
      this.emit("stop", undefined);
      this.origin.cacophony?.emit("globalStop", {
        source: this.origin,
        timestamp: Date.now(),
      });
    }
  }

  get playbackRate(): number {
    return 1;
  }

  set playbackRate(_rate: number) {}

  addFilter(filter: BiquadFilterNode): void {
    if (!this.source) {
      throw new Error("Cannot add a filter to a media stream that has been cleaned up");
    }
    super.addFilter(filter);
    this.refreshFilters();
  }

  removeFilter(filter: BiquadFilterNode): void {
    if (!this.source) {
      throw new Error("Cannot remove a filter from a media stream that has been cleaned up");
    }
    super.removeFilter(filter);
    this.refreshFilters();
  }

  private refreshFilters(): void {
    if (!this.panner || !this.gainNode) {
      throw new Error("Cannot update filters on a media stream that has been cleaned up");
    }
    let connection = this.panner;
    connection.disconnect();
    connection = this.applyFilters(connection);
    connection.connect(this.gainNode);
  }

  get outputNode(): GainNode {
    if (!this.gainNode) {
      throw new Error("Cannot access output node of a media stream that has been cleaned up");
    }
    return this.gainNode;
  }

  connect(destination: AudioNode | AudioParam): AudioNode {
    return this.outputNode.connect(destination as any);
  }

  disconnect(destination?: AudioNode | AudioParam): void {
    if (destination) {
      this.outputNode.disconnect(destination as any);
    } else {
      this.outputNode.disconnect();
    }
  }

  cleanup(): void {
    if (!this.source) {
      return;
    }
    this._playing = false;
    this.source.disconnect();
    this.source = undefined;
    super.cleanup();
  }
}

export class MediaStreamSound extends PlaybackContainer(FilterManager) implements BaseSound {
  public declare playbacks: MediaStreamPlayback[];
  private context: BaseContext;
  private globalGainNode: GainNode;
  private stream: MediaStream;
  private stopTracksOnStop: boolean;
  private panType: PanType;

  constructor(
    stream: MediaStream,
    context: BaseContext,
    globalGainNode: GainNode,
    options: MediaStreamSoundOptions = {},
    private _cacophony?: Cacophony,
  ) {
    super();
    this.stream = stream;
    this.context = context;
    this.globalGainNode = globalGainNode;
    this.panType = options.panType ?? "HRTF";
    this.stopTracksOnStop = options.stopTracksOnStop ?? true;
  }

  get cacophony(): Cacophony | undefined {
    return this._cacophony;
  }

  private createStreamSource(stream: MediaStream): MediaStreamAudioSourceNode {
    if (!this.context.createMediaStreamSource) {
      throw new Error("Media stream sources are not supported on this audio context (e.g. OfflineAudioContext).");
    }
    return this.context.createMediaStreamSource(stream);
  }

  preplay(): MediaStreamPlayback[] {
    if (this.playbacks[0]) {
      return [this.playbacks[0]];
    }

    const source = this.createStreamSource(this.stream);
    const gainNode = this.context.createGain();
    const playback = new MediaStreamPlayback(
      this,
      source,
      gainNode,
      this.context,
      this.globalGainNode,
      this.panType,
      this.stopTracksOnStop,
    );
    playback.volume = this.volume;
    if (this.panType === "HRTF") {
      playback.threeDOptions = this.threeDOptions;
      playback.position = this.position;
    } else {
      playback.stereoPan = this.stereoPan ?? 0;
    }
    this._filters.forEach((filter) => playback.addFilter(filter));
    this.playbacks.push(playback);
    return [playback];
  }

  seek(_time: number): void {}

  loop(_loopCount?: LoopCount): LoopCount {
    return 0;
  }

  get playbackRate(): number {
    return 1;
  }

  set playbackRate(_rate: number) {}

  cleanup(): void {
    this.stop();
    super.cleanup();
  }
}
