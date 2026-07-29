import { BasePlayback } from "./basePlayback";
import type { BaseSound, Cacophony, LoopCount, PanType } from "./cacophony";
import type {
  AudioNode,
  AudioParam,
  BaseContext,
  BiquadFilterNode,
  GainNode,
  MediaStreamAudioSourceNode,
} from "./context";
import { RoutableSource } from "./routableSource";

export interface MediaStreamSoundOptions {
  panType?: PanType;
  stopTracksOnStop?: boolean;
  /**
   * Attach the stream to a muted `HTMLAudioElement` while it plays.
   *
   * Chromium will not render a remote WebRTC `MediaStreamTrack` that is only
   * connected to the Web Audio graph: packets arrive but the decoder produces
   * zero samples, so a `MediaStreamAudioSourceNode` taps pure silence. Pulling
   * the same stream through a media element "primes" the decode pipeline; the
   * Web Audio path then receives real audio. The element is muted so it does
   * not double-play over the (possibly spatialised) Web Audio output. Firefox
   * does not need this, but the priming element is harmless there.
   *
   * Defaults to `true`. Set to `false` for streams that are never routed to a
   * Web Audio graph, or in environments without `HTMLAudioElement`.
   */
  primeWithMediaElement?: boolean;
}

export class MediaStreamPlayback extends BasePlayback {
  public declare origin: MediaStreamSound;
  public declare source?: MediaStreamAudioSourceNode;
  private stopTracksOnStop: boolean;
  /**
   * Muted media element that keeps Chromium's decode pipeline alive for the
   * stream so the Web Audio tap receives real audio. See
   * {@link MediaStreamSoundOptions.primeWithMediaElement}.
   */
  private primeElement?: HTMLAudioElement;

  constructor(
    origin: MediaStreamSound,
    source: MediaStreamAudioSourceNode,
    gainNode: GainNode,
    context: BaseContext,
    outputNode: AudioNode,
    panType: PanType,
    stopTracksOnStop: boolean,
    primeWithMediaElement: boolean = true,
  ) {
    super(origin);
    this.stopTracksOnStop = stopTracksOnStop;
    this.source = source;
    this.setPanType(panType, context);
    this.setGainNode(gainNode);
    this.source.connect(this.panner!);
    this.panner!.connect(this.gainNode!);
    this.gainNode!.connect(outputNode);
    this.refreshFilters();
    if (primeWithMediaElement) {
      this.createPrimeElement();
    }
  }

  private createPrimeElement(): void {
    if (typeof Audio === "undefined" || !this.source) {
      return;
    }
    try {
      const element = new Audio();
      element.muted = true;
      element.srcObject = this.source.mediaStream;
      this.primeElement = element;
    } catch {
      // Environment without media-element support: priming is best-effort.
      this.primeElement = undefined;
    }
  }

  private teardownPrimeElement(): void {
    const element = this.primeElement;
    if (!element) {
      return;
    }
    this.primeElement = undefined;
    try {
      element.pause();
      element.srcObject = null;
    } catch {
      // Element may already be torn down by the browser.
    }
  }

  get duration(): number {
    return 0;
  }

  play(): [this] {
    if (!this.source) {
      throw new Error("Cannot play a media stream that has been cleaned up");
    }
    if (this.isPlaying) {
      return [this];
    }
    const tracks = this.source.mediaStream.getTracks();
    if (tracks.length > 0 && tracks.every((track) => track.readyState === "ended")) {
      throw new Error("Cannot play a media stream whose tracks have ended");
    }
    tracks.forEach((track) => (track.enabled = true));
    // Muted autoplay is always permitted, so this needs no user gesture; the
    // returned promise is ignored because failure only loses Chromium priming.
    this.primeElement?.play().catch(() => {});
    this.markPlaying();
    this.emit("play", this);
    this.origin.cacophony?.emit("globalPlay", {
      source: this.origin,
      timestamp: Date.now(),
    });
    return [this];
  }

  pause(): void {
    if (!this.source || !this.isPlaying) {
      return;
    }
    this.source.mediaStream.getTracks().forEach((track) => (track.enabled = false));
    this.primeElement?.pause();
    this.markPaused();
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
    const shouldEmitStop = this._state === "playing" || this._state === "paused";
    if (this.stopTracksOnStop) {
      this.source.mediaStream.getTracks().forEach((track) => track.stop());
    }
    this.teardownPrimeElement();
    this.markStopped();
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
    let connection: AudioNode = this.panner;
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
    this.markStopped();
    this.teardownPrimeElement();
    this.source.disconnect();
    this.source = undefined;
    super.cleanup();
  }
}

export class MediaStreamSound extends RoutableSource implements BaseSound {
  public declare playbacks: MediaStreamPlayback[];
  protected context: BaseContext;
  protected globalGainNode: GainNode;
  private stream: MediaStream;
  private stopTracksOnStop: boolean;
  private panType: PanType;
  private primeWithMediaElement: boolean;

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
    this.primeWithMediaElement = options.primeWithMediaElement ?? true;
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
      this._resolveRouteTargetNode(),
      this.panType,
      this.stopTracksOnStop,
      this.primeWithMediaElement,
    );
    this._wireRouteSends(playback);
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

  resume(): void {
    this.playbacks.forEach((playback) => playback.resume());
  }

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
