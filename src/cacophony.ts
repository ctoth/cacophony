import phaseVocoderProcessorWorkletUrl from "./bundles/phase-vocoder-bundle.js?url";
import { AudioCache, type ICache } from "./cache";
import type { AudioBuffer, AudioListener, BaseContext, BiquadFilterNode, GainNode, PannerNode } from "./context";
import { TypedEventEmitter } from "./eventEmitter";
import type { CacophonyEvents } from "./events";
import { Group } from "./group";
import { MicrophoneStream } from "./microphone";
import { Sound } from "./sound";
import { Synth } from "./synth";

export enum SoundType {
  HTML = "HTML",
  Streaming = "Streaming",
  Buffer = "Buffer",
  Oscillator = "oscillator",
}

/**
 * Represents a 3D position in space.
 * @typedef {Array<number>} Position - An array of three numbers representing the x, y, and z coordinates.
 */
export type Position = [x: number, y: number, z: number];

/**
 * Represents the orientation of an object in 3D space.
 * @typedef {Object} Orientation - An object containing two positions: forward and up.
 * @property {Position} forward - The forward direction of the object.
 * @property {Position} up - The up direction of the object.
 */
export type Orientation = {
  forward: Position;
  up: Position;
};

/**
 * Represents the number of times a sound should loop.
 * @typedef {number | 'infinite'} LoopCount - The number of loops, or 'infinite' for endless looping.
 */
export type LoopCount = number | "infinite";

/**
 * Represents the type of fade effect to apply.
 * @typedef {'linear' | 'exponential'} FadeType - The fade type, either 'linear' or 'exponential'.
 */
export type FadeType = "linear" | "exponential";

/**
 * Represents the type of panning effect to apply.
 * @typedef {'HRTF' | 'stereo'} PanType - The pan type, either 'HRTF' for 3D audio or 'stereo' for traditional stereo panning.
 */
export type PanType = "HRTF" | "stereo";

/**
 * Options for configuring fade behavior when starting playback via Sound.play().
 * @interface PlayOptions
 */
export interface PlayOptions {
  fadeIn?: number; // duration in ms
  fadeOut?: number; // duration in ms
  fadeType?: FadeType; // applies to both fadeIn and fadeOut
  fadeInPerLoop?: boolean; // re-trigger fadeIn on each loop iteration
}

/**
 * The base interface for any sound-producing entity, including individual sounds, groups, and playbacks.
 * @interface BaseSound
 */
export interface BaseSound {
  isPlaying: boolean;
  play(): BaseSound[];
  seek?(time: number): void;
  stop(): void;
  pause(): void;
  addFilter(filter: BiquadFilterNode): void;
  removeFilter(filter: BiquadFilterNode): void;
  volume: number;
  position?: Position;
  threeDOptions?: any;
  fadeTo?(value: number, duration: number, type?: FadeType): Promise<void>;
  fadeIn?(duration: number, type?: FadeType): Promise<void>;
  fadeOut?(duration: number, type?: FadeType): Promise<void>;
  stopWithFade?(duration: number, type?: FadeType): Promise<void>;
}

/**
 * Options for creating an offline audio context.
 */
export interface OfflineOptions {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  context?: BaseContext & { startRendering(): Promise<AudioBuffer> };
}

export interface RuntimeOptions {
  createAudioWorkletNode?: (context: BaseContext, name: string) => any;
}

/**
 * Resources belonging to a Sound that must be released when the Sound is
 * garbage collected without an explicit cleanup() call. The record is a plain
 * data bag with no back-references to the Sound or its Playbacks — a
 * FinalizationRegistry strongly retains its held value, so holding the Sound
 * itself would prevent the target from ever becoming collectable.
 */
export interface SoundCleanupHoldings {
  sources: Array<{ disconnect(): void }>;
  gainNodes: GainNode[];
  mediaElements: HTMLMediaElement[];
}

export class Cacophony {
  context: BaseContext;
  globalGainNode: GainNode;
  listener: AudioListener;
  private prevVolume: number = 1;
  private finalizationRegistry: FinalizationRegistry<SoundCleanupHoldings>;
  private eventEmitter: TypedEventEmitter<CacophonyEvents> = new TypedEventEmitter<CacophonyEvents>();
  private cache: ICache;
  private createAudioWorkletNode: (context: BaseContext, name: string) => any;

  constructor(context?: BaseContext, cache?: ICache, runtimeOptions: RuntimeOptions = {}) {
    this.context = context || new AudioContext();
    this.listener = this.context.listener;
    this.globalGainNode = this.context.createGain();
    this.globalGainNode.connect(this.context.destination);
    this.cache = cache || new AudioCache();
    this.createAudioWorkletNode =
      runtimeOptions.createAudioWorkletNode ||
      ((workletContext, name) => new AudioWorkletNode(workletContext as any, name));

    this.finalizationRegistry = new FinalizationRegistry((holdings) => {
      for (const source of holdings.sources) {
        source.disconnect();
      }
      for (const gainNode of holdings.gainNodes) {
        gainNode.disconnect();
      }
      for (const media of holdings.mediaElements) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    });
  }

  /** @internal */
  registerSoundForCleanup(sound: object, holdings: SoundCleanupHoldings, unregisterToken: object): void {
    this.finalizationRegistry.register(sound, holdings, unregisterToken);
  }

  /** @internal */
  unregisterSoundCleanup(unregisterToken: object): void {
    this.finalizationRegistry.unregister(unregisterToken);
  }

  /**
   * Creates a Cacophony instance backed by an OfflineAudioContext.
   * Use this for rendering, bouncing, precomputing processed output,
   * or non-realtime scenarios.
   *
   * @param options - Offline context configuration (channels, length, sampleRate)
   * @param cache - Optional cache implementation
   * @returns A Cacophony instance backed by OfflineAudioContext
   */
  static createOffline(options: OfflineOptions, cache?: ICache): Cacophony {
    const offlineContext =
      options.context || new OfflineAudioContext(options.numberOfChannels, options.length, options.sampleRate);
    return new Cacophony(offlineContext, cache);
  }

  /**
   * Returns true if this instance is backed by an offline audio context
   * (i.e., the context has a startRendering method).
   */
  get isOffline(): boolean {
    return typeof this.context.startRendering === "function";
  }

  /**
   * Renders the offline audio graph to a buffer.
   * Only available when the context has a startRendering method.
   *
   * @returns Promise that resolves to the rendered AudioBuffer
   * @throws Error if the context does not support offline rendering
   */
  async startRendering(): Promise<AudioBuffer> {
    if (typeof this.context.startRendering !== "function") {
      throw new Error(
        "startRendering() is only available on offline audio contexts. Use Cacophony.createOffline() to create one.",
      );
    }
    return this.context.startRendering();
  }

  /**
   * Register event listener.
   * @returns Cleanup function
   */
  on<K extends keyof CacophonyEvents>(event: K, listener: (data: CacophonyEvents[K]) => void): () => void {
    return this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof CacophonyEvents>(event: K, listener: (data: CacophonyEvents[K]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  emit<K extends keyof CacophonyEvents>(event: K, data: CacophonyEvents[K]): void {
    this.eventEmitter.emit(event, data);
  }

  async emitAsync<K extends keyof CacophonyEvents>(event: K, data: CacophonyEvents[K]): Promise<void> {
    return this.eventEmitter.emitAsync(event, data);
  }

  async loadWorklets(signal?: AbortSignal) {
    if (this.context.audioWorklet) {
      await this.createWorkletNode("phase-vocoder", phaseVocoderProcessorWorkletUrl, signal);
    } else {
      console.warn("AudioWorklet not supported");
    }
  }

  async createWorkletNode(name: string, url: string, signal?: AbortSignal) {
    // ensure audioWorklet has been loaded
    if (!this.context.audioWorklet) {
      throw new Error("AudioWorklet not supported");
    }
    try {
      return this.createAudioWorkletNode(this.context, name);
    } catch (err) {
      console.error(err);
      console.log("Loading worklet from url", url);
      try {
        await this.context.audioWorklet.addModule(url, {
          credentials: "same-origin",
          ...(signal && { signal }),
        });
      } catch (err) {
        console.error(err);
        throw err; // Preserve original error (including AbortError)
      }

      return this.createAudioWorkletNode(this.context, name);
    }
  }

  private createAbortError(): DOMException {
    return new DOMException("Operation was aborted", "AbortError");
  }

  private createMediaSound(
    url: string,
    soundType: SoundType.HTML | SoundType.Streaming,
    panType: PanType,
    signal?: AbortSignal,
  ): Promise<Sound> {
    if (signal?.aborted) {
      return Promise.reject(this.createAbortError());
    }

    return new Promise<Sound>((resolve, reject) => {
      const audio = new Audio();
      let settled = false;

      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
        audio.removeEventListener("error", handleError);
        signal?.removeEventListener("abort", handleAbort);
      };

      const teardown = () => {
        audio.pause();
        audio.src = "";
        audio.load();
      };

      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };

      const handleLoadedMetadata = () => {
        settle(() => {
          resolve(new Sound(url, undefined, this.context, this.globalGainNode, soundType, panType, this));
        });
      };

      const handleError = () => {
        const error = new Error(`Failed to load audio from ${url}`);
        settle(() => {
          teardown();
          reject(error);
        });
      };

      const handleAbort = () => {
        const error = this.createAbortError();
        settle(() => {
          teardown();
          reject(error);
        });
      };

      audio.crossOrigin = "anonymous";
      audio.preload = "auto";
      audio.addEventListener("loadedmetadata", handleLoadedMetadata);
      audio.addEventListener("error", handleError);
      signal?.addEventListener("abort", handleAbort, { once: true });
      audio.src = url;
      audio.load();
    });
  }

  clearMemoryCache(): void {
    this.cache.clearMemoryCache();
  }

  createOscillator(options: OscillatorOptions, panType: PanType = "HRTF"): Synth {
    const synth = new Synth(this.context, this.globalGainNode, SoundType.Oscillator, panType, options, this);
    return synth;
  }

  /**
   * Creates a Sound instance from an AudioBuffer or URL.
   *
   * @param bufferOrUrl - AudioBuffer instance or URL string to create sound from
   * @param soundType - Type of sound (Buffer, HTML, Streaming)
   * @param panType - Type of panning (HRTF or stereo)
   * @param signal - Optional AbortSignal to cancel the operation
   * @returns Promise that resolves to a Sound instance
   */
  async createSound(
    buffer: AudioBuffer,
    soundType?: SoundType,
    panType?: PanType,
    signal?: AbortSignal,
  ): Promise<Sound>;

  async createSound(url: string, soundType?: SoundType, panType?: PanType, signal?: AbortSignal): Promise<Sound>;

  async createSound(
    bufferOrUrl: AudioBuffer | string,
    soundType: SoundType = SoundType.Buffer,
    panType: PanType = "HRTF",
    signal?: AbortSignal,
  ): Promise<Sound> {
    if (typeof bufferOrUrl === "object") {
      return Promise.resolve(
        new Sound("", bufferOrUrl, this.context, this.globalGainNode, SoundType.Buffer, panType, this),
      );
    }
    const url = bufferOrUrl;
    if (soundType === SoundType.HTML) {
      return this.createMediaSound(url, SoundType.HTML, panType, signal);
    }
    if (soundType === SoundType.Streaming) {
      return this.createMediaSound(url, SoundType.Streaming, panType, signal);
    }
    return this.cache
      .getAudioBuffer(this.context, url, signal, {
        onLoadingStart: (event) => this.emitAsync("loadingStart", event),
        onLoadingProgress: (event) => this.emitAsync("loadingProgress", event),
        onLoadingComplete: (event) => this.emitAsync("loadingComplete", event),
        onLoadingError: (event) => this.emitAsync("loadingError", event),
        onCacheHit: (event) => this.emitAsync("cacheHit", event),
        onCacheMiss: (event) => this.emitAsync("cacheMiss", event),
        onCacheError: (event) => this.emitAsync("cacheError", event),
      })
      .then((buffer) => new Sound(url as string, buffer, this.context, this.globalGainNode, soundType, panType, this));
  }

  async createGroup(sounds: Sound[]): Promise<Group> {
    const group = new Group();
    sounds.forEach((sound) => group.addSound(sound));
    return group;
  }

  /**
   * Creates a Group containing Sound instances loaded from multiple URLs.
   *
   * @param urls - Array of URL strings to load as sounds
   * @param soundType - Type of sound (Buffer, HTML, Streaming)
   * @param panType - Type of panning (HRTF or stereo)
   * @param signal - Optional AbortSignal to cancel the operation
   * @returns Promise that resolves to a Group containing all loaded sounds
   */
  async createGroupFromUrls(
    urls: string[],
    soundType: SoundType = SoundType.Buffer,
    panType: PanType = "HRTF",
    signal?: AbortSignal,
  ): Promise<Group> {
    const group = new Group();
    const sounds = await Promise.all(urls.map((url) => this.createSound(url, soundType, panType, signal)));
    sounds.forEach((sound) => group.addSound(sound));
    return group;
  }

  /**
   * Creates a streaming Sound instance from a URL.
   *
   * @param url - URL string to stream audio from
   * @param signal - Optional AbortSignal to cancel the operation
   * @returns Promise that resolves to a Sound instance for streaming
   */
  async createStream(url: string, signal?: AbortSignal): Promise<Sound> {
    return this.createMediaSound(url, SoundType.Streaming, "HRTF", signal);
  }

  createBiquadFilter = ({ type, frequency, gain, Q }: BiquadFilterOptions): BiquadFilterNode => {
    if (frequency === undefined) {
      frequency = 350;
    }
    const filter = this.context.createBiquadFilter();
    filter.type = type || "lowpass";
    filter.frequency.value = frequency;
    filter.gain.value = gain || 0;
    filter.Q.value = Q || 1;
    return filter;
  };

  /**
   * Creates a PannerNode with the specified options.
   * @param {PannerOptions} options - An object containing the options to use when creating the PannerNode.
   * @returns {PannerNode} A new PannerNode instance with the specified options.
   * @example
   * const panner = audio.createPanner({
   *  positionX: 0,
   * positionY: 0,
   * positionZ: 0,
   * orientationX: 0,
   * orientationY: 0,
   * orientationZ: 0,
   * });
   */

  createPanner({
    coneInnerAngle,
    coneOuterAngle,
    coneOuterGain,
    distanceModel,
    maxDistance,
    channelCount,
    channelCountMode,
    channelInterpretation,
    panningModel,
    refDistance,
    rolloffFactor,
    positionX,
    positionY,
    positionZ,
    orientationX,
    orientationY,
    orientationZ,
  }: Partial<PannerOptions>): PannerNode {
    const panner = this.context.createPanner();
    panner.coneInnerAngle = coneInnerAngle || 360;
    panner.coneOuterAngle = coneOuterAngle || 360;
    panner.coneOuterGain = coneOuterGain || 0;
    panner.distanceModel = distanceModel || "inverse";
    panner.maxDistance = maxDistance || 10000;
    panner.channelCount = channelCount || 2;
    panner.channelCountMode = channelCountMode || "clamped-max";
    panner.channelInterpretation = channelInterpretation || "speakers";
    panner.panningModel = panningModel || "HRTF";
    panner.refDistance = refDistance || 1;
    panner.rolloffFactor = rolloffFactor || 1;
    panner.positionX.value = positionX || 0;
    panner.positionY.value = positionY || 0;
    panner.positionZ.value = positionZ || 0;
    panner.orientationX.value = orientationX || 0;
    panner.orientationY.value = orientationY || 0;
    panner.orientationZ.value = orientationZ || 0;
    return panner;
  }

  /**
   * Suspends the audio context.
   */
  pause(): void {
    if (this.context.suspend) {
      this.context.suspend();
      this.emit("suspend", undefined);
    }
  }

  /**
   * Resumes the audio context.
   * This method is required to resume the audio context on mobile devices.
   * On desktop, the audio context will automatically resume when a sound is played.
   */

  resume() {
    if (this.context.resume) {
      this.context.resume();
      this.emit("resume", undefined);
    }
  }

  setGlobalVolume(volume: number) {
    if (this.globalGainNode.gain.value === volume) {
      return;
    }
    this.globalGainNode.gain.value = volume;
    this.emit("volumeChange", volume);
  }

  get volume(): number {
    return this.globalGainNode.gain.value;
  }

  set volume(volume: number) {
    if (this.muted) {
      this.prevVolume = volume;
      return;
    }
    this.setGlobalVolume(volume);
  }

  mute() {
    if (!this.muted) {
      this.prevVolume = this.globalGainNode.gain.value;
      this.setGlobalVolume(0);
      this.emit("mute", undefined);
    }
  }

  unmute() {
    if (this.muted) {
      this.setGlobalVolume(this.prevVolume);
      this.emit("unmute", undefined);
    }
  }

  get muted(): boolean {
    return this.globalGainNode.gain.value === 0;
  }

  set muted(muted: boolean) {
    if (muted !== this.muted) {
      if (muted) {
        this.mute();
      } else {
        this.unmute();
      }
    }
  }

  getMicrophoneStream(): Promise<MicrophoneStream> {
    return new Promise((resolve, reject) => {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          const microphoneStream = new MicrophoneStream(this.context, stream);
          resolve(microphoneStream);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  get listenerOrientation(): Orientation {
    return {
      forward: [this.listener.forwardX.value, this.listener.forwardY.value, this.listener.forwardZ.value],
      up: [this.listener.upX.value, this.listener.upY.value, this.listener.upZ.value],
    };
  }

  set listenerOrientation(orientation: Orientation) {
    const { forward, up } = orientation;
    const [forwardX, forwardY, forwardZ] = forward;
    const [upX, upY, upZ] = up;
    this.listener.forwardX.value = forwardX;
    this.listener.forwardY.value = forwardY;
    this.listener.forwardZ.value = forwardZ;
    this.listener.upX.value = upX;
    this.listener.upY.value = upY;
    this.listener.upZ.value = upZ;
  }

  get listenerUpOrientation(): Position {
    return [this.listener.upX.value, this.listener.upY.value, this.listener.upZ.value];
  }

  set listenerUpOrientation(up: Position) {
    const [x, y, z] = up;
    this.listener.upX.value = x;
    this.listener.upY.value = y;
    this.listener.upZ.value = z;
  }

  get listenerForwardOrientation(): Position {
    return [this.listener.forwardX.value, this.listener.forwardY.value, this.listener.forwardZ.value];
  }

  set listenerForwardOrientation(forward: Position) {
    const [x, y, z] = forward;
    this.listener.forwardX.value = x;
    this.listener.forwardY.value = y;
    this.listener.forwardZ.value = z;
  }

  get listenerPosition(): Position {
    return [this.listener.positionX.value, this.listener.positionY.value, this.listener.positionZ.value];
  }

  set listenerPosition(position: Position) {
    const [x, y, z] = position;
    const currentTime = this.context.currentTime;
    this.listener.positionX.setValueAtTime(x, currentTime);
    this.listener.positionY.setValueAtTime(y, currentTime);
    this.listener.positionZ.setValueAtTime(z, currentTime);
  }
}
