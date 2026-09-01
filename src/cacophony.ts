import foaHrirUrl from "./assets/sh_hrir_order_1.wav?url";
import { AudioSprite, type CreateSpriteOptions, type SpriteMap, type SpriteRegion } from "./audioSprite";
import { installAutoplayUnlock } from "./autoplayUnlock";
import { Bus } from "./bus";
import { AudioCache, type ICache } from "./cache";
import type {
  AudioBuffer,
  AudioListener,
  AudioNode,
  AudioParam,
  AudioWorkletNode,
  BaseContext,
  BiquadFilterNode,
  ChannelMergerNode,
  ChannelSplitterNode,
  GainNode,
  PannerNode,
} from "./context";
import {
  BarberpoleEffect,
  type BarberpoleOptions,
  type CacophonyEffect,
  DynamicsEffect,
  type DynamicsOptions,
  FdnReverbEffect,
  type FdnReverbOptions,
  FoaDecoder,
  FoaDecoderEffect,
  type FoaDecoderOptions,
  FrequencyShifterEffect,
  type FrequencyShifterOptions,
  HarmonizerEffect,
  type HarmonizerOptions,
  ImpulseResponseEffect,
  type ImpulseResponseOptions,
  type ImpulseResponseSource,
  ModulatedDelayEffect,
  type ModulatedDelayOptions,
  markAsCacophonyBiquad,
  PhaserEffect,
  type PhaserOptions,
  ReverbEffect,
  type ReverbOptions,
  ShareEffect,
  SpectralFreezeEffect,
  type SpectralFreezeOptions,
  StereoWidenerEffect,
  type StereoWidenerOptions,
  TremoloEffect,
  type TremoloOptions,
  WaveshaperEffect,
  type WaveshaperOptions,
} from "./effects";
import { TypedEventEmitter } from "./eventEmitter";
import type { CacophonyEvents } from "./events";
import { Group } from "./group";
import { HlsAdapter } from "./hlsAdapter";
import { type CacophonyLogger, consoleLogger, noopLogger } from "./logger";
import { MediaStreamSound, type MediaStreamSoundOptions } from "./mediaStream";
import { LoudnessMeter } from "./meters/loudness-meter";
import { MicrophoneStream, type MicrophoneStreamOptions } from "./microphone";
import type { ThreeDOptions } from "./pannerMixin";
import { PcmStreamSound, type PcmStreamSoundOptions } from "./pcmStream";
import { GATE_DEFAULT_RATIO } from "./processors/dynamics-core";
import { DATTORRO_INV_SQRT2 } from "./processors/modulated-delay-core";
import { type TimeStretchOptions, timeStretch } from "./processors/timestretch-core";
import { Sound } from "./sound";
import { Synth } from "./synth";
import { WebCodecsPullAdapter, type WebCodecsStreamSound } from "./webCodecsStream";
import { ALL_WORKLETS, WORKLETS, type WorkletModule } from "./worklets";

export type SoundType = "html" | "streaming" | "buffer" | "oscillator";

export interface StreamCapabilities {
  transport: "webcodecs" | "media-element";
  seekable: boolean;
  live: boolean;
  duration: number;
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

/** Stereo-to-FOA worklet algorithm selection. */
export interface StereoToBFormatOptions {
  /** Perceptual three-band upmix (default) or frequency-domain BCC analysis. */
  algorithm?: "perceptual" | "bcc";
}

/**
 * Options for configuring fade behavior when starting playback via Sound.play().
 * @interface PlayOptions
 */
export interface PlayOptions {
  /** Absolute AudioContext time, in seconds, for a buffer source's first start. */
  at?: number;
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
  streamCapabilities?: StreamCapabilities;
  play(options?: PlayOptions): BaseSound[];
  seek?(time: number): void;
  stop(): void;
  pause(): void;
  addFilter(filter: BiquadFilterNode): void;
  removeFilter(filter: BiquadFilterNode): void;
  volume: number;
  position?: Position;
  threeDOptions?: ThreeDOptions;
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
  createAudioWorkletNode?: (context: BaseContext, name: string, options?: AudioWorkletNodeOptions) => any;
  /**
   * Optional hook to remap a worklet module URL just before it is handed to
   * `audioWorklet.addModule`. Receives the worklet's {@link WorkletModule.name}
   * and its default {@link WorkletModule.url}; return the URL to load (return
   * `url` unchanged to keep the default).
   *
   * The library build inlines every worklet bundle as a base64 `data:` URL,
   * which the browser loads directly but `node-web-audio-api` cannot resolve.
   * The `cacophony/node` adapter installs a resolver here that points
   * `addModule` at the bundle file on disk instead, so worklet-backed effects
   * work headless. Has no effect in the browser, where the default is used.
   */
  resolveWorkletUrl?: (name: string, url: string) => string | Promise<string>;
  /**
   * If `true` (the default), Cacophony installs one-time `touchend` / `click` /
   * `keydown` listeners on `document.body` whenever the audio context is
   * constructed in `suspended` state. The first user gesture resumes the
   * context, plays a silent primer buffer (required by iOS Safari for the
   * context to truly unlock), removes the listeners, and emits the `unlock`
   * event on the Cacophony instance.
   *
   * Set to `false` to opt out — you are then responsible for calling
   * `cacophony.resume()` yourself in response to a user gesture.
   *
   * Has no effect when the context is already running, on offline contexts,
   * or in non-browser environments (`document === undefined`).
   *
   * @default true
   */
  autoUnlock?: boolean;
  /**
   * Optional logger for Cacophony's host-side diagnostic output (the
   * `[cacophony/worklet]` messages emitted while loading AudioWorklet
   * modules, plus the "AudioWorklet not supported" warning).
   *
   * When provided, all such output is routed through this object instead of
   * the global `console`. Useful for capturing or redirecting logs in Node /
   * headless / CLI hosts. Takes precedence over {@link RuntimeOptions.quiet}.
   *
   * @default consoleLogger (forwards to `console`)
   */
  logger?: CacophonyLogger;
  /**
   * If `true`, suppresses all of Cacophony's host-side diagnostic output by
   * installing a no-op logger. Equivalent to passing `logger: noopLogger`.
   *
   * Ignored when an explicit {@link RuntimeOptions.logger} is also provided.
   *
   * @default false
   */
  quiet?: boolean;
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

const WORKLET_LOG_PREFIX = "[cacophony/worklet]";

/**
 * Extension → MIME type map used by `createSound` format fallback to query
 * `HTMLAudioElement.canPlayType`. Keys are lower-cased extensions without
 * the leading dot.
 */
const EXTENSION_MIME_MAP: Readonly<Record<string, string>> = Object.freeze({
  webm: "audio/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/ogg; codecs=opus",
});

/**
 * Returns the MIME type for a URL based on its file extension, or `null` if
 * the extension is not recognised. Query strings and fragments are ignored.
 */
function mimeTypeForUrl(url: string): string | null {
  const withoutQuery = url.split(/[?#]/, 1)[0];
  const dotIndex = withoutQuery.lastIndexOf(".");
  if (dotIndex < 0) {
    return null;
  }
  const ext = withoutQuery.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_MIME_MAP[ext] ?? null;
}

/** Web Audio default listener pose when AudioParams are absent. */
const DEFAULT_LISTENER_POSITION: Position = [0, 0, 0];
const DEFAULT_LISTENER_FORWARD: Position = [0, 0, -1];
const DEFAULT_LISTENER_UP: Position = [0, 1, 0];

type ListenerOrientationParams = {
  readonly forwardX: AudioParam;
  readonly forwardY: AudioParam;
  readonly forwardZ: AudioParam;
  readonly upX: AudioParam;
  readonly upY: AudioParam;
  readonly upZ: AudioParam;
};

type ListenerPositionParams = {
  readonly positionX: AudioParam;
  readonly positionY: AudioParam;
  readonly positionZ: AudioParam;
};

function isAudioParam(param: unknown): param is AudioParam {
  return typeof param === "object" && param !== null && "value" in param && typeof param.value === "number";
}

function isSchedulableAudioParam(param: unknown): param is AudioParam {
  return isAudioParam(param) && "setValueAtTime" in param && typeof param.setValueAtTime === "function";
}

/**
 * Real hosts are all-or-nothing: Chrome/Safari/SAC expose the full orientation
 * param set, Firefox exposes none. One predicate covers that split.
 */
function hasListenerOrientationParams(listener: AudioListener): listener is AudioListener & ListenerOrientationParams {
  return (
    isAudioParam(listener.forwardX) &&
    isAudioParam(listener.forwardY) &&
    isAudioParam(listener.forwardZ) &&
    isAudioParam(listener.upX) &&
    isAudioParam(listener.upY) &&
    isAudioParam(listener.upZ)
  );
}

function hasListenerPositionParams(listener: AudioListener): listener is AudioListener & ListenerPositionParams {
  return (
    isSchedulableAudioParam(listener.positionX) &&
    isSchedulableAudioParam(listener.positionY) &&
    isSchedulableAudioParam(listener.positionZ)
  );
}

function readListenerOrientation(listener: ListenerOrientationParams): { forward: Position; up: Position } {
  return {
    forward: [listener.forwardX.value, listener.forwardY.value, listener.forwardZ.value],
    up: [listener.upX.value, listener.upY.value, listener.upZ.value],
  };
}

function readListenerPosition(listener: ListenerPositionParams): Position {
  return [listener.positionX.value, listener.positionY.value, listener.positionZ.value];
}

/**
 * Write listener orientation through AudioParams, or `setOrientation` when
 * those params are missing.
 */
function writeListenerOrientation(listener: AudioListener, forward: Position, up: Position): void {
  const [forwardX, forwardY, forwardZ] = forward;
  const [upX, upY, upZ] = up;
  if (hasListenerOrientationParams(listener)) {
    listener.forwardX.value = forwardX;
    listener.forwardY.value = forwardY;
    listener.forwardZ.value = forwardZ;
    listener.upX.value = upX;
    listener.upY.value = upY;
    listener.upZ.value = upZ;
    return;
  }
  if (typeof listener.setOrientation === "function") {
    listener.setOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ);
    return;
  }
  throw new Error("AudioListener does not support orientation updates");
}

/**
 * Write listener position through AudioParams, or `setPosition` when those
 * params are missing.
 */
function writeListenerPosition(listener: AudioListener, position: Position, currentTime: number): void {
  const [x, y, z] = position;
  if (hasListenerPositionParams(listener)) {
    listener.positionX.setValueAtTime(x, currentTime);
    listener.positionY.setValueAtTime(y, currentTime);
    listener.positionZ.setValueAtTime(z, currentTime);
    return;
  }
  if (typeof listener.setPosition === "function") {
    listener.setPosition(x, y, z);
    return;
  }
  throw new Error("AudioListener does not support position updates");
}

export class Cacophony {
  context: BaseContext;
  globalGainNode: GainNode;
  /**
   * The master bus — `master.input` IS `globalGainNode` (literally the same
   * GainNode), so every existing `.connect(globalGainNode)` call in the
   * codebase remains correct. `cacophony.volume` and `cacophony.mute` still
   * read and write `master.input.gain.value` through that alias.
   */
  master: Bus;
  listener: AudioListener;
  /**
   * Last-known listener pose. Used by getters when AudioParams are unreadable
   * (seeded from params or Web Audio defaults in the constructor).
   */
  private cachedListenerPosition: Position = [...DEFAULT_LISTENER_POSITION];
  private cachedListenerForward: Position = [...DEFAULT_LISTENER_FORWARD];
  private cachedListenerUp: Position = [...DEFAULT_LISTENER_UP];
  private prevVolume: number = 1;
  private isMuted: boolean = false;
  /**
   * Per-context cache of "module-name has been loaded on this BaseContext".
   * Keyed on the context itself because `AudioWorklet.addModule()` registers
   * the module against ONE context — a module loaded on context A is NOT
   * loaded on context B. A previous host-scoped `Set<string>` short-circuited
   * `loadAudioWorkletModule()` on name alone, so cross-context
   * {@link ReverbEffect.build} would skip `addModule` on the new context and
   * the second construct would throw with no module registered.
   */
  private loadedAudioWorklets: WeakMap<BaseContext, Set<string>> = new WeakMap();
  /**
   * Per-context cache of the decoded order-1 SH-HRIR `AudioBuffer` used by
   * {@link FoaDecoder}. Keyed on the context (like
   * {@link loadedAudioWorklets}) because `decodeAudioData` produces a buffer
   * bound to ONE context's sample rate; a buffer decoded on context A must not
   * be reused on context B. Stores the in-flight Promise so concurrent
   * `loadFoaHrir` calls share a single fetch/decode.
   */
  private foaHrirCache: WeakMap<BaseContext, Promise<AudioBuffer>> = new WeakMap();
  /**
   * Per-context, per-URL decoded impulse-response cache. Stores in-flight
   * promises so concurrent effect builds for the same context/URL share the
   * same fetch/decode. Rejected promises are evicted so the caller can retry.
   */
  private impulseResponseCache: WeakMap<BaseContext, Map<string, Promise<AudioBuffer>>> = new WeakMap();
  private finalizationRegistry: FinalizationRegistry<SoundCleanupHoldings>;
  private eventEmitter: TypedEventEmitter<CacophonyEvents> = new TypedEventEmitter<CacophonyEvents>();
  private cache: ICache;
  private createAudioWorkletNode: (context: BaseContext, name: string, options?: AudioWorkletNodeOptions) => any;
  private resolveWorkletUrl?: (name: string, url: string) => string | Promise<string>;
  private logger: CacophonyLogger;
  /**
   * Named-bus registry. Populated by {@link createBus} when a name is
   * supplied; entries are removed by the bus's onDestroy hook.
   */
  private _busRegistry: Map<string, Bus> = new Map();
  // Tracks the lifecycle state we have explicitly transitioned to. This avoids
  // duplicate wrapper-driven suspend calls, but resume() still delegates because
  // the underlying AudioContext can be suspended externally.
  private suspendState: "unknown" | "running" | "suspended" = "unknown";
  // Cleanup function for the autoplay-unlock state watcher and gesture
  // listeners. No-op when autoUnlock is disabled or unsupported.
  private autoplayUnlockCleanup: () => void = () => {};

  /**
   * Constructs a new Cacophony instance.
   *
   * If the supplied (or auto-constructed) audio context is in `suspended`
   * state and `runtimeOptions.autoUnlock` is `true` (default), one-time
   * `touchend` / `click` / `keydown` listeners are installed on
   * `document.body` so the first user gesture transparently unlocks audio
   * — matching Howler's `autoUnlock` behavior. See
   * {@link RuntimeOptions.autoUnlock} for the opt-out and the iOS primer
   * rationale.
   *
   * @param context - Audio context to use. If omitted, a fresh `AudioContext`
   *   is constructed (which on mobile will be `suspended` until a user
   *   gesture, triggering the auto-unlock path described above).
   * @param cache - Optional cache implementation. Defaults to `AudioCache`.
   * @param runtimeOptions - Optional runtime configuration including the
   *   `autoUnlock` opt-out and a `createAudioWorkletNode` factory override.
   */
  constructor(context?: BaseContext, cache?: ICache, runtimeOptions: RuntimeOptions = {}) {
    this.context = context ?? new AudioContext();
    this.listener = this.context.listener;
    if (hasListenerPositionParams(this.listener)) {
      this.cachedListenerPosition = readListenerPosition(this.listener);
    }
    if (hasListenerOrientationParams(this.listener)) {
      const orientation = readListenerOrientation(this.listener);
      this.cachedListenerForward = orientation.forward;
      this.cachedListenerUp = orientation.up;
    }
    this.globalGainNode = this.context.createGain();
    // master bus wraps globalGainNode as its input — same node, two accessors.
    // master is exempt from the named-bus registry (its name 'master' is
    // reserved and not user-creatable via createBus).
    // The Bus constructor wires input → output. We then connect master.output
    // to context.destination so the full audible path is:
    //   master.input (= globalGainNode) → [filters] → master.output → destination.
    // Critical: connect master.output AFTER constructing the Bus, NOT
    // globalGainNode directly. If globalGainNode were pre-connected to
    // destination, adding a master filter would call _refreshFilters() which
    // disconnects master.input's outgoing edges, severing the audible path.
    this.master = new Bus(this.context, "master", this.globalGainNode, undefined, false);
    this.master.output.connect(this.context.destination);
    this.cache = cache ?? new AudioCache();
    this.createAudioWorkletNode =
      runtimeOptions.createAudioWorkletNode ??
      ((workletContext, name, options) => new AudioWorkletNode(workletContext as any, name, options));
    this.resolveWorkletUrl = runtimeOptions.resolveWorkletUrl;
    this.logger = runtimeOptions.logger ?? (runtimeOptions.quiet ? noopLogger : consoleLogger);

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

    // Install autoplay unlock — guarded against offline contexts here and
    // unsupported/non-browser environments inside installAutoplayUnlock.
    // Offline contexts cannot suspend in the same way, so unlock makes no
    // sense for them.
    const autoUnlock = runtimeOptions.autoUnlock !== false;
    if (autoUnlock && !this.isOffline) {
      this.autoplayUnlockCleanup = installAutoplayUnlock({
        context: this.context,
        onUnlock: () => {
          this.suspendState = "running";
          this.emit("unlock", undefined);
        },
      });
    }
  }

  /**
   * Returns `true` while the audio context is suspended — i.e. the library
   * cannot produce sound until the context is resumed (typically by a user
   * gesture). After the auto-unlock fires (or `resume()` is called manually),
   * this becomes `false`.
   *
   * Mirrors Howler's `Howler.ctx.state === 'suspended'` check via the
   * `Howler` global's `_audioUnlocked`. Use this to gate UI that hints to
   * the user that an interaction is required to start audio.
   */
  get locked(): boolean {
    const state = (this.context as unknown as { state?: string }).state;
    return state === "suspended";
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
   * @param runtimeOptions - Optional runtime configuration
   * @returns A Cacophony instance backed by OfflineAudioContext
   */
  static createOffline(options: OfflineOptions, cache?: ICache, runtimeOptions?: RuntimeOptions): Cacophony {
    const offlineContext =
      options.context ?? new OfflineAudioContext(options.numberOfChannels, options.length, options.sampleRate);
    return new Cacophony(offlineContext, cache, runtimeOptions);
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
   * OFFLINE independent time-stretch: change an AudioBuffer's tempo WITHOUT
   * changing its pitch, returning a NEW AudioBuffer of length ≈
   * `round(buffer.length · factor)` at the same sample rate.
   *
   * Algorithm: Phase Gradient Heap Integration (PGHI) per Zdeněk Průša & Nicki
   * Holighaus, "Phase Vocoder Done Right" (EUSIPCO 2017 / arXiv:2202.07382).
   * The signal is STFT'd, the synthesis phase is reconstructed by integrating
   * the analysis-phase time/frequency gradients along the magnitude ridges
   * (max-heap), then overlap-added at the stretched synthesis hop. No peak
   * picking and no transient detection. Each channel is processed independently.
   *
   * This is an OFFLINE buffer transform, NOT a real-time worklet: the project's
   * OLA worklet base is unity-rate (analysis hop == synthesis hop, fixed to the
   * 128-sample render quantum) and cannot change the time base in real time. A
   * genuine independent stretch needs analysis hop ≠ synthesis hop, which only
   * the whole-buffer offline path provides.
   *
   * @param buffer The source AudioBuffer to time-stretch.
   * @param factor Stretch factor (`> 0`). `> 1` lengthens (slower tempo), `< 1`
   *               shortens (faster tempo); pitch is preserved either way.
   * @param options Optional PGHI parameters (fftSize, analysisHop, tol, seed).
   * @returns A new, time-stretched AudioBuffer.
   * @throws If the context cannot create buffers, or `factor <= 0`.
   */
  timeStretchBuffer(buffer: AudioBuffer, factor: number, options?: TimeStretchOptions): AudioBuffer {
    if (typeof this.context.createBuffer !== "function") {
      throw new Error("timeStretchBuffer requires an audio context that supports createBuffer().");
    }
    if (!(factor > 0)) {
      throw new Error(`timeStretchBuffer: factor must be > 0, got ${factor}`);
    }

    const numberOfChannels = buffer.numberOfChannels;
    const outLength = Math.max(1, Math.round(buffer.length * factor));
    const output = this.context.createBuffer(numberOfChannels, outLength, buffer.sampleRate);

    for (let ch = 0; ch < numberOfChannels; ch++) {
      // Copy out of the (possibly mocked) AudioBuffer into a plain Float32Array
      // the pure core can consume, then write the stretched result back.
      const inData = buffer.getChannelData(ch);
      const input = inData instanceof Float32Array ? inData : Float32Array.from(inData);
      const stretched = timeStretch(input, factor, options);
      // The core returns exactly round(input.length·factor) samples; copy what
      // fits the output buffer (lengths match by construction).
      output.copyToChannel(stretched.subarray(0, outLength), ch);
    }

    return output;
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

  /**
   * Eagerly registers every bundled AudioWorklet module on this context. This is
   * OPTIONAL — effects load their own worklet lazily in `build`, and the
   * pitch-shift path loads the phase-vocoder on first use. Call this up front to
   * pay the registration cost ahead of time. Idempotent per context (each module
   * short-circuits via the per-context {@link loadedAudioWorklets} set).
   */
  async loadWorklets(signal?: AbortSignal): Promise<void> {
    if (!this.context.audioWorklet) {
      this.logger.warn("AudioWorklet not supported");
      return;
    }
    for (const worklet of ALL_WORKLETS) {
      await this.loadAudioWorkletModule(worklet.name, worklet.url, signal);
    }
  }

  async loadStereoToBFormatWorklet(signal?: AbortSignal): Promise<void> {
    await this.loadAudioWorkletModule(WORKLETS.stereoToBFormat.name, WORKLETS.stereoToBFormat.url, signal);
  }

  /**
   * The single worklet-effect construction seam ({@link WorkletEffectHost}).
   * Idempotently registers `worklet`'s module on `context` — or this host's own
   * context when omitted, honoring the cross-context contract that effects'
   * `build(context)` promises — then constructs the AudioWorkletNode with
   * `parameterData`. Every worklet-backed {@link CacophonyEffect} routes through
   * here, as does the phase-vocoder pitch-shift path ({@link Playback.setPitchShift}).
   */
  async buildWorkletEffect(
    worklet: WorkletModule,
    parameterData: Record<string, number>,
    context?: BaseContext,
    nodeOptions?: AudioWorkletNodeOptions,
  ): Promise<AudioWorkletNode> {
    await this.loadAudioWorkletModule(worklet.name, worklet.url, undefined, context);
    return this.createWorkletNode(
      worklet.name,
      worklet.url,
      undefined,
      { ...nodeOptions, parameterData: { ...(nodeOptions?.parameterData ?? {}), ...parameterData } },
      context,
    );
  }

  /**
   * Fetches and decodes the bundled order-1 SH-HRIR
   * (`sh_hrir_order_1.wav`, from Omnitone, Apache-2.0 — see
   * `src/assets/NOTICE`) into an `AudioBuffer`, memoized per context. The
   * buffer is the 4-channel (ACN rows W,Y,Z,X) SH-domain HRIR consumed by
   * {@link FoaDecoder} to drive its WY/ZX stereo ConvolverNodes
   * (Ahrens 2022 eq.31 decode).
   *
   * The WAV is 48 kHz; `decodeAudioData` resamples it to the context's sample
   * rate automatically when they differ (standard Web Audio behavior, which
   * Omnitone relies on).
   *
   * @param context Optional BaseContext to decode on. Defaults to this host's
   *   own `context`. Supplied so a {@link FoaDecoder} added to a bus on
   *   a different context decodes the HRIR on the right context.
   */
  async loadFoaHrir(context?: BaseContext): Promise<AudioBuffer> {
    const ctx = context ?? this.context;
    const cached = this.foaHrirCache.get(ctx);
    if (cached) {
      return cached;
    }
    const pending = (async () => {
      const response = await fetch(foaHrirUrl);
      const encoded = await response.arrayBuffer();
      return ctx.decodeAudioData(encoded);
    })();
    this.foaHrirCache.set(ctx, pending);
    try {
      return await pending;
    } catch (err) {
      // Drop the rejected promise so a later call can retry the fetch/decode.
      this.foaHrirCache.delete(ctx);
      throw err;
    }
  }

  /**
   * Fetches and decodes an impulse response URL on the requested audio context,
   * memoized per context and URL. Buffers decoded by one context are not reused
   * on another context, matching Web Audio's context-bound decode behavior.
   *
   * @param url Impulse-response audio URL.
   * @param context Optional decode context. Defaults to this Cacophony instance.
   * @param signal Optional abort signal for the fetch. Decode itself is not
   *   abortable in Web Audio, but an already-aborted signal is honored before
   *   decode starts.
   */
  async loadImpulseResponseBuffer(url: string, context?: BaseContext, signal?: AbortSignal): Promise<AudioBuffer> {
    const ctx = context ?? this.context;
    let cacheForContext = this.impulseResponseCache.get(ctx);
    if (!cacheForContext) {
      cacheForContext = new Map<string, Promise<AudioBuffer>>();
      this.impulseResponseCache.set(ctx, cacheForContext);
    }
    const cached = cacheForContext.get(url);
    if (cached) {
      return this.waitForImpulseResponseLoad(cached, signal);
    }
    if (signal?.aborted) {
      throw this.createAbortError();
    }

    const pending = (async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load impulse response from ${url}: ${response.status} ${response.statusText}`);
      }
      const encoded = await response.arrayBuffer();
      return ctx.decodeAudioData(encoded);
    })();
    cacheForContext.set(url, pending);
    void pending.catch(() => {
      if (cacheForContext.get(url) === pending) {
        cacheForContext.delete(url);
      }
    });
    return this.waitForImpulseResponseLoad(pending, signal);
  }

  async createWorkletNode(
    name: string,
    url: string,
    signal?: AbortSignal,
    options?: AudioWorkletNodeOptions,
    context?: BaseContext,
  ): Promise<AudioWorkletNode> {
    // Use the supplied context for cross-context worklet construction
    // (e.g. ReverbEffect built against a context other than this host's
    // own). Default to this host's `context` for the common single-context
    // case so all existing callers keep working without a change.
    const ctx = context ?? this.context;
    // ensure audioWorklet has been loaded
    if (!ctx.audioWorklet) {
      throw new Error("AudioWorklet not supported");
    }
    try {
      const node = this.createAudioWorkletNode(ctx, name, options);
      this.logger.info(`${WORKLET_LOG_PREFIX} construct succeeded`, {
        name,
        loaded: this.isWorkletLoadedOn(ctx, name),
      });
      return node;
    } catch (err) {
      this.logger.warn(`${WORKLET_LOG_PREFIX} construct failed`, {
        name,
        loaded: this.isWorkletLoadedOn(ctx, name),
        error: err,
      });
      try {
        await this.loadAudioWorkletModule(name, url, signal, ctx);
      } catch (err) {
        this.logger.error(`${WORKLET_LOG_PREFIX} load failed`, {
          name,
          error: err,
        });
        throw err; // Preserve original error (including AbortError)
      }

      try {
        const node = this.createAudioWorkletNode(ctx, name, options);
        this.logger.info(`${WORKLET_LOG_PREFIX} construct after load succeeded`, { name });
        return node;
      } catch (err) {
        this.logger.error(`${WORKLET_LOG_PREFIX} construct after load failed`, {
          name,
          error: err,
        });
        throw err;
      }
    }
  }

  async createStereoToBFormatNode(
    options: StereoToBFormatOptions = {},
    signal?: AbortSignal,
  ): Promise<AudioWorkletNode> {
    const worklet = options.algorithm === "bcc" ? WORKLETS.bccEncoder : WORKLETS.stereoToBFormat;
    return this.createWorkletNode(worklet.name, worklet.url, signal, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [4],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
  }

  /**
   * Lookup helper: has worklet `name` been loaded on `ctx` (per the
   * per-context {@link loadedAudioWorklets} cache).
   */
  private isWorkletLoadedOn(ctx: BaseContext, name: string): boolean {
    return this.loadedAudioWorklets.get(ctx)?.has(name) ?? false;
  }

  /**
   * Record `name` as loaded on `ctx`, lazily allocating the per-context Set.
   */
  private markWorkletLoadedOn(ctx: BaseContext, name: string): void {
    let names = this.loadedAudioWorklets.get(ctx);
    if (!names) {
      names = new Set<string>();
      this.loadedAudioWorklets.set(ctx, names);
    }
    names.add(name);
  }

  private async loadAudioWorkletModule(
    name: string,
    url: string,
    signal?: AbortSignal,
    context?: BaseContext,
  ): Promise<void> {
    const ctx = context ?? this.context;
    if (!ctx.audioWorklet) {
      throw new Error("AudioWorklet not supported");
    }
    // Per-context membership: a module loaded on context A is NOT loaded on
    // context B. The previous host-scoped check by name only would skip the
    // addModule on B after A had loaded the same name, leaving B without
    // the worklet registered.
    if (this.isWorkletLoadedOn(ctx, name)) {
      this.logger.info(`${WORKLET_LOG_PREFIX} load skipped`, { name });
      return;
    }
    // Host seam: the browser loads the inlined `data:` bundle directly, but the
    // Node backend remaps to the on-disk bundle file (see RuntimeOptions.resolveWorkletUrl).
    const resolvedUrl = this.resolveWorkletUrl ? await this.resolveWorkletUrl(name, url) : url;
    this.logger.info(`${WORKLET_LOG_PREFIX} addModule start`, {
      name,
      url: resolvedUrl,
      aborted: signal?.aborted ?? false,
    });
    try {
      await ctx.audioWorklet.addModule(resolvedUrl, {
        credentials: "same-origin",
        ...(signal && { signal }),
      });
      this.markWorkletLoadedOn(ctx, name);
      this.logger.info(`${WORKLET_LOG_PREFIX} addModule resolved`, { name });
    } catch (err) {
      this.logger.error(`${WORKLET_LOG_PREFIX} addModule rejected`, {
        name,
        error: err,
      });
      throw err;
    }
  }

  private createAbortError(): DOMException {
    return new DOMException("Operation was aborted", "AbortError");
  }

  private waitForImpulseResponseLoad(pending: Promise<AudioBuffer>, signal?: AbortSignal): Promise<AudioBuffer> {
    if (!signal) {
      return pending;
    }
    if (signal.aborted) {
      return Promise.reject(this.createAbortError());
    }
    return new Promise((resolve, reject) => {
      const handleAbort = () => {
        cleanup();
        reject(this.createAbortError());
      };
      const cleanup = () => {
        signal.removeEventListener("abort", handleAbort);
      };
      signal.addEventListener("abort", handleAbort, { once: true });
      pending.then(
        (buffer) => {
          cleanup();
          resolve(buffer);
        },
        (err: unknown) => {
          cleanup();
          reject(err);
        },
      );
    });
  }

  private createMediaSound(
    url: string,
    soundType: "html" | "streaming",
    panType: PanType,
    signal?: AbortSignal,
    preparedAudio?: HTMLAudioElement,
    useHlsJs: boolean = false,
  ): Promise<Sound> {
    if (signal?.aborted) {
      return Promise.reject(this.createAbortError());
    }

    return new Promise<Sound>((resolve, reject) => {
      const audio = preparedAudio ?? new Audio();
      let hlsAdapter: HlsAdapter | undefined;
      let sound: Sound | undefined;
      let settled = false;
      const pendingHlsErrors: Array<{ error: Error; recoverable: boolean }> = [];

      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
        audio.removeEventListener("error", handleError);
        signal?.removeEventListener("abort", handleAbort);
      };

      const teardown = () => {
        hlsAdapter?.destroy();
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
          sound = new Sound(
            url,
            undefined,
            this.context,
            this.globalGainNode,
            soundType,
            panType,
            this,
            audio,
            hlsAdapter ? () => hlsAdapter?.destroy() : undefined,
          );
          if (soundType === "streaming") {
            sound.streamCapabilities = {
              duration: Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY,
              live: audio.duration === Number.POSITIVE_INFINITY,
              seekable: (audio.seekable?.length ?? 0) > 0,
              transport: "media-element",
            };
          }
          for (const { error, recoverable } of pendingHlsErrors) {
            sound.reportLoadError(error, recoverable);
          }
          resolve(sound);
        });
      };

      const handleHlsError = (error: Error, recoverable: boolean) => {
        if (sound) {
          sound.reportLoadError(error, recoverable);
        } else if (recoverable) {
          pendingHlsErrors.push({ error, recoverable });
        } else {
          settle(() => {
            teardown();
            reject(error);
          });
        }
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
      if (useHlsJs) {
        void HlsAdapter.create(handleHlsError).then(
          (adapter) => {
            hlsAdapter = adapter;
            if (settled) {
              adapter.destroy();
              return;
            }
            try {
              adapter.attach(audio, url);
            } catch (error) {
              settle(() => {
                teardown();
                reject(error);
              });
            }
          },
          (error: unknown) => {
            settle(() => {
              teardown();
              reject(error);
            });
          },
        );
      } else {
        audio.src = url;
        audio.load();
      }
    });
  }

  private createHlsSound(url: string, panType: PanType, signal?: AbortSignal): Promise<Sound> {
    const audio = new Audio();
    const nativeHls = audio.canPlayType("application/vnd.apple.mpegurl") || audio.canPlayType("application/x-mpegURL");
    return this.createMediaSound(url, "streaming", panType, signal, audio, !nativeHls);
  }

  clearMemoryCache(): void {
    this.cache.clearMemoryCache();
  }

  createOscillator(options: OscillatorOptions, panType: PanType = "HRTF"): Synth {
    const synth = new Synth(this.context, this.globalGainNode, "oscillator", panType, options, this);
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

  /**
   * Creates a Sound from the first playable URL in a Howler-style fallback
   * array. The browser's `HTMLAudioElement.canPlayType` is queried per
   * extension; the first source it reports as supported (`'probably'` or
   * `'maybe'`) is fetched and decoded. If decoding rejects for a candidate,
   * the next playable candidate is tried — a `'maybe'` can still fail at
   * decode time.
   *
   * MIME types are inferred from file extensions: `.webm` → `audio/webm`,
   * `.mp3` → `audio/mpeg`, `.ogg` → `audio/ogg`, `.wav` → `audio/wav`,
   * `.flac` → `audio/flac`, `.m4a` → `audio/mp4`, `.aac` → `audio/aac`,
   * `.opus` → `audio/ogg; codecs=opus`.
   *
   * Cache and loading events fire only for the URL actually fetched.
   *
   * v1 limitation: only the default `'buffer'` sound type participates in
   * fallback. Passing an array with any non-`'buffer'` soundType (e.g.
   * `'html'`, `'streaming'`, `'oscillator'`) rejects with a clear "not yet
   * supported" error.
   *
   * @param urls - Non-empty array of candidate URLs in priority order.
   * @throws If the array is empty, if `soundType` is not `'buffer'`, or if
   *   no candidate is playable (codec unsupported or every decode failed).
   *   The error message names the URLs that were tried.
   */
  async createSound(urls: string[], soundType?: SoundType, panType?: PanType, signal?: AbortSignal): Promise<Sound>;

  async createSound(
    bufferOrUrl: AudioBuffer | string | string[],
    soundType: SoundType = "buffer",
    panType: PanType = "HRTF",
    signal?: AbortSignal,
  ): Promise<Sound> {
    if (Array.isArray(bufferOrUrl)) {
      return this.createSoundFromUrlArray(bufferOrUrl, soundType, panType, signal);
    }
    if (typeof bufferOrUrl === "object") {
      return Promise.resolve(new Sound("", bufferOrUrl, this.context, this.globalGainNode, soundType, panType, this));
    }
    const url = bufferOrUrl;
    if (soundType === "html") {
      return this.createMediaSound(url, "html", panType, signal);
    }
    if (soundType === "streaming") {
      return this.createMediaSound(url, "streaming", panType, signal);
    }
    return this.loadBufferSound(url, soundType, panType, signal);
  }

  /** Create ordinary, independently configurable Sounds over named regions of one shared buffer. */
  async createSprite<M extends SpriteMap>(
    source: string | AudioBuffer,
    map: M,
    options: CreateSpriteOptions = {},
  ): Promise<AudioSprite<Extract<keyof M, string>>> {
    type Key = Extract<keyof M, string>;
    const buffer = typeof source === "string" ? await this.loadAudioBuffer(source, options.signal) : source;
    const names = Object.keys(map) as Key[];
    if (names.length === 0) {
      throw new Error("Audio sprite map must contain at least one region");
    }

    const normalized = new Map<Key, Readonly<SpriteRegion>>();
    for (const name of names) {
      const region = map[name];
      if (!region || !Number.isFinite(region.start) || region.start < 0) {
        throw new Error(`Invalid audio sprite region '${name}': start must be a finite number >= 0`);
      }
      if (!Number.isFinite(region.duration) || region.duration <= 0) {
        throw new Error(`Invalid audio sprite region '${name}': duration must be a finite number > 0`);
      }
      if (region.start + region.duration > buffer.duration) {
        const startFrames = region.start * buffer.sampleRate;
        const durationFrames = region.duration * buffer.sampleRate;
        const startFrame = Math.round(startFrames);
        const durationFrameCount = Math.round(durationFrames);
        const isFrameExact = (frames: number, rounded: number) =>
          Math.abs(frames - rounded) <= Number.EPSILON * Math.max(1, Math.abs(frames)) * 4;
        const frameExactEndFits =
          isFrameExact(startFrames, startFrame) &&
          isFrameExact(durationFrames, durationFrameCount) &&
          startFrame + durationFrameCount <= buffer.length;
        if (!frameExactEndFits) {
          throw new Error(`Invalid audio sprite region '${name}': region exceeds the buffer duration`);
        }
      }
      if (
        region.loopCount !== undefined &&
        region.loopCount !== "infinite" &&
        (!Number.isInteger(region.loopCount) || region.loopCount < 0)
      ) {
        throw new Error(
          `Invalid audio sprite region '${name}': loopCount must be a non-negative integer or 'infinite'`,
        );
      }
      normalized.set(name, Object.freeze({ ...region }));
    }

    const sounds = Object.create(null) as Record<Key, Sound>;
    const created: Sound[] = [];
    try {
      for (const name of names) {
        const region = normalized.get(name)!;
        const sound = new Sound(
          typeof source === "string" ? source : "",
          buffer,
          this.context,
          this.globalGainNode,
          "buffer",
          options.panType ?? "HRTF",
          this,
          undefined,
          undefined,
          region,
          name,
        );
        if (region.loopCount !== undefined) {
          sound.loop(region.loopCount);
        }
        sounds[name] = sound;
        created.push(sound);
      }
      return new AudioSprite(sounds, names);
    } catch (error) {
      for (const sound of created) sound.cleanup();
      throw error;
    }
  }

  private loadAudioBuffer(url: string, signal?: AbortSignal): Promise<AudioBuffer> {
    return this.cache.getAudioBuffer(this.context, url, signal, {
      onLoadingStart: (event) => this.emitAsync("loadingStart", event),
      onLoadingProgress: (event) => this.emitAsync("loadingProgress", event),
      onLoadingComplete: (event) => this.emitAsync("loadingComplete", event),
      onLoadingError: (event) => this.emitAsync("loadingError", event),
      onCacheHit: (event) => this.emitAsync("cacheHit", event),
      onCacheMiss: (event) => this.emitAsync("cacheMiss", event),
      onCacheError: (event) => this.emitAsync("cacheError", event),
    });
  }

  private async loadBufferSound(
    url: string,
    soundType: SoundType,
    panType: PanType,
    signal?: AbortSignal,
  ): Promise<Sound> {
    const buffer = await this.loadAudioBuffer(url, signal);
    return new Sound(url, buffer, this.context, this.globalGainNode, soundType, panType, this);
  }

  /**
   * Returns true if the error came from `AudioContext.decodeAudioData`.
   *
   * Per the Web Audio spec, decode failures throw a `DOMException` with name
   * `EncodingError`. We deliberately do NOT treat plain `Error` instances as
   * decode failures: fetch/cache/network errors must propagate so the caller
   * sees the real cause instead of silently falling through to a different
   * format. See `reports/format-fallback-codex-review.md` (Major 1).
   */
  private static isDecodeError(error: unknown): boolean {
    if (typeof DOMException === "undefined") {
      return false;
    }
    return error instanceof DOMException && error.name === "EncodingError";
  }

  private async createSoundFromUrlArray(
    urls: string[],
    soundType: SoundType,
    panType: PanType,
    signal?: AbortSignal,
  ): Promise<Sound> {
    if (urls.length === 0) {
      throw new Error("createSound: URL array is empty; provide at least one URL");
    }
    if (soundType !== "buffer") {
      throw new Error(
        `createSound: URL array with soundType='${soundType}' is not yet supported. ` +
          `Format fallback is only available for buffer sounds in this version.`,
      );
    }
    const candidateReasons = new Map<string, string>();
    const playable: string[] = [];
    for (const url of urls) {
      if (this.canPlaySource(url)) {
        playable.push(url);
      } else {
        const ext = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i)?.[1]?.toLowerCase();
        candidateReasons.set(url, ext ? `codec unsupported: .${ext}` : "codec unsupported: unknown extension");
      }
    }
    if (playable.length === 0) {
      const detail = urls.map((u) => `${u}: ${candidateReasons.get(u) ?? "codec unsupported"}`).join("; ");
      throw new Error(
        `createSound: no playable source found among [${urls.join(", ")}] ` +
          `(no candidate's MIME type was reported as supported by HTMLAudioElement.canPlayType). ` +
          `Reasons: ${detail}`,
      );
    }
    for (const url of playable) {
      try {
        // Array path always produces buffer sounds; html/streaming were rejected above.
        return await this.loadBufferSound(url, "buffer", panType, signal);
      } catch (error) {
        if ((error as { name?: string } | null)?.name === "AbortError") {
          throw error;
        }
        if (!Cacophony.isDecodeError(error)) {
          // Fetch/cache/network failure of the selected source — propagate.
          // Only decode failures fall through to the next candidate.
          throw error;
        }
        candidateReasons.set(url, `decode failed: ${(error as Error)?.message ?? String(error)}`);
      }
    }
    const detail = urls.map((u) => `${u}: ${candidateReasons.get(u) ?? "unknown"}`).join("; ");
    throw new Error(
      `createSound: every playable candidate failed to decode. Tried [${urls.join(", ")}]. Reasons: ${detail}`,
    );
  }

  private canPlaySource(url: string): boolean {
    if (typeof Audio === "undefined") {
      return true;
    }
    const mime = mimeTypeForUrl(url);
    if (!mime) {
      return false;
    }
    try {
      const probe = new Audio();
      const result = probe.canPlayType(mime);
      return result === "probably" || result === "maybe";
    } catch {
      return false;
    }
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
    soundType: SoundType = "buffer",
    panType: PanType = "HRTF",
    signal?: AbortSignal,
  ): Promise<Group> {
    const group = new Group();
    const sounds = await Promise.all(urls.map((url) => this.createSound(url, soundType, panType, signal)));
    sounds.forEach((sound) => group.addSound(sound));
    return group;
  }

  /**
   * Creates a sample-accurate URL stream when WebCodecs can decode the primary
   * audio track. Encoded media is fetched and demuxed incrementally, then its
   * PCM is fed into the same routable AudioWorklet source returned by
   * {@link createPcmStreamSound}. Browsers without WebCodecs, or without a
   * decoder for the track, fall back to the media-element streaming tier.
   * @param url - Encoded audio stream URL.
   * @param signal - Optional cancellation signal retained as the second
   * parameter for backwards compatibility.
   * @param panType - Type of panning (HRTF or stereo).
   */
  async createStream(
    url: string,
    signal?: AbortSignal,
    panType: PanType = "HRTF",
  ): Promise<Sound | WebCodecsStreamSound> {
    if (/\.m3u8(?:$|[?#])/i.test(url)) {
      return this.createHlsSound(url, panType, signal);
    }

    if (typeof globalThis.AudioDecoder !== "function") {
      return this.createMediaSound(url, "streaming", panType, signal);
    }

    const adapter = await WebCodecsPullAdapter.open(url, this.context.sampleRate, signal);
    if (!adapter) {
      return this.createMediaSound(url, "streaming", panType, signal);
    }
    try {
      const sound = await this.createPcmStreamSound({
        channelCount: adapter.channelCount,
        panType,
        signal,
      });
      return adapter.attach(sound);
    } catch (error) {
      adapter.cleanup();
      throw error;
    }
  }

  createMediaStreamSound(stream: MediaStream, options?: MediaStreamSoundOptions): MediaStreamSound {
    return new MediaStreamSound(stream, this.context, this.globalGainNode, options, this);
  }

  /**
   * Creates a push-based PCM source backed by a fixed-size AudioWorklet ring
   * buffer. Each write is an interleaved Float32Array at this context's sample
   * rate.
   */
  async createPcmStreamSound(options: PcmStreamSoundOptions = {}): Promise<PcmStreamSound> {
    options.signal?.throwIfAborted();
    const channelCount = options.channelCount ?? 1;
    const bufferDuration = options.bufferDuration ?? 1;
    const latency = options.latency ?? 0.05;
    if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 32) {
      throw new RangeError("PCM channelCount must be an integer between 1 and 32");
    }
    if (!Number.isFinite(bufferDuration) || bufferDuration <= 0) {
      throw new RangeError("PCM bufferDuration must be greater than zero");
    }
    if (!Number.isFinite(latency) || latency < 0 || latency > bufferDuration) {
      throw new RangeError("PCM latency must be between zero and bufferDuration");
    }

    const capacityFrames = Math.ceil(this.context.sampleRate * bufferDuration);
    const latencyFrames = Math.ceil(this.context.sampleRate * latency);
    const node = await this.createWorkletNode(WORKLETS.pcmStream.name, WORKLETS.pcmStream.url, options.signal, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [channelCount],
      channelCount,
      channelCountMode: "explicit",
      processorOptions: {
        capacityFrames,
        channelCount,
        latencyFrames,
      },
    });
    const sound = new PcmStreamSound(
      node,
      this.context,
      this.globalGainNode,
      {
        ...options,
        channelCount,
        bufferDuration,
        latency,
      },
      this,
    );
    if (options.signal?.aborted) {
      sound.cleanup();
      options.signal.throwIfAborted();
    }
    return sound;
  }

  createBiquadFilter = ({ type, frequency, gain, Q }: BiquadFilterOptions): BiquadFilterNode => {
    if (frequency === undefined) {
      frequency = 350;
    }
    const filter = this.context.createBiquadFilter();
    filter.type = type ?? "lowpass";
    filter.frequency.value = frequency;
    filter.gain.value = gain ?? 0;
    filter.Q.value = Q ?? 1;
    markAsCacophonyBiquad(filter);
    return filter;
  };

  /**
   * Wraps a raw AudioNode in a {@link CacophonyEffect} so it can be added
   * to a {@link Bus} filter chain. By default `Bus.addFilter` rejects raw
   * AudioNodes — wrapping via `shareEffect` is the explicit opt-in that
   * signals "yes, I understand this single node will be shared across every
   * bus I add it to."
   */
  shareEffect(node: AudioNode): CacophonyEffect {
    return new ShareEffect(node);
  }

  /**
   * Creates a DattorroReverb {@link CacophonyEffect}. The effect's `build`
   * lazily registers the worklet module (no-op if already loaded) and
   * constructs the AudioWorkletNode with the supplied {@link ReverbOptions}
   * as `parameterData`. Add the returned effect to a {@link Bus}'s filter
   * chain via `bus.addFilter(effect)`.
   */
  createReverb(options: ReverbOptions = {}): ReverbEffect {
    return new ReverbEffect(this, options);
  }

  /**
   * Creates a native ConvolverNode impulse-response effect. Pass an AudioBuffer
   * for an already-decoded IR or a URL to fetch/decode through the per-context
   * IR cache. The default is wet-only (`dry: 0`, `wet: 1`) and returns a single
   * ConvolverNode when added to a bus; setting `dry` or non-unity `wet` builds
   * an owned dry/wet endpoint graph exposing `dry` and `wet` automation params.
   */
  createImpulseResponse(source: ImpulseResponseSource, options: ImpulseResponseOptions = {}): ImpulseResponseEffect {
    return new ImpulseResponseEffect(this, source, options);
  }

  /**
   * Creates a Feedback Delay Network (FDN) {@link CacophonyEffect} — an
   * algorithmic reverb with a lossless degree-0 paraunitary Hadamard feedback
   * matrix (Schlecht & Habets 2019), per-delay-line absorption filters setting
   * the reverberation time T60 (Jot & Chaigne 1991), and multiplication-free
   * velvet-noise input diffusion (Fagerström et al. 2020). The effect's
   * `build` lazily registers the worklet module (no-op if already loaded) and
   * constructs the AudioWorkletNode with the supplied {@link FdnReverbOptions}
   * as `parameterData`. Add the returned effect to a {@link Bus} via
   * `bus.addFilter(effect)`.
   */
  createFdnReverb(options: FdnReverbOptions = {}): FdnReverbEffect {
    return new FdnReverbEffect(this, options);
  }

  /**
   * Creates a dynamics {@link CacophonyEffect} configured as a COMPRESSOR
   * (ratio > 1 reduces the level of signals above threshold). Implements the
   * feed-forward design of Giannoulis, Massberg & Reiss 2012. Add the returned
   * effect to a {@link Bus} via `bus.addFilter(effect)`. The same machinery
   * (gain computer + log-domain smooth-branching detector) backs the limiter
   * and gate presets below.
   */
  createCompressor(options: DynamicsOptions = {}): DynamicsEffect {
    return new DynamicsEffect(this, options);
  }

  /**
   * Creates a dynamics {@link CacophonyEffect} preset as a LIMITER — a
   * compressor with an effectively infinite ratio so output is clamped at the
   * threshold (Giannoulis 2012 eqs 18-19). The ratio is fixed to the worklet's
   * limiter sentinel; caller-supplied `ratio` is ignored. Other params
   * (threshold, knee, attack, release, makeup) remain configurable.
   */
  createLimiter(options: Omit<DynamicsOptions, "ratio"> = {}): DynamicsEffect {
    return new DynamicsEffect(this, { ...options, ratio: 1000 });
  }

  /**
   * Creates a dynamics {@link CacophonyEffect} preset as a downward EXPANDER /
   * GATE — ratio < 1 so signals BELOW the threshold are pushed further down
   * (Giannoulis 2012 p.403). The default `ratio` of 0.1 gives gate-like
   * downward expansion; pass a `ratio` closer to 1 for gentler expansion.
   */
  createGate(options: DynamicsOptions = {}): DynamicsEffect {
    return new DynamicsEffect(this, { ratio: GATE_DEFAULT_RATIO, ...options });
  }

  /**
   * Creates a {@link WaveshaperEffect} — an antialiased distortion/waveshaper
   * implementing first-order Antiderivative Antialiasing (Parker, Zavalishin &
   * Le Bivic 2016, DAFx-16): y[n] = (F0(x_n) - F0(x_{n-1}))/(x_n - x_{n-1})
   * (eq.9), with an f(midpoint) fallback at the 0/0 singularity (eq.10). Ships
   * two nonlinearities — `shape: 0` hard clip (polynomial F0, eq.25), `shape: 1`
   * tanh soft clip (F0 = log cosh, eq.20). Carries an inherent 0.5-sample group
   * delay (eq.17). Add the returned effect to a {@link Bus} via
   * `bus.addFilter(effect)`.
   */
  createWaveshaper(options: WaveshaperOptions = {}): WaveshaperEffect {
    return new WaveshaperEffect(this, options);
  }

  /**
   * Creates a {@link WaveshaperEffect} preset as a DISTORTION — the tanh soft
   * clipper (`shape: 1`, F0 = log cosh, Parker 2016 eq.20) with a default drive
   * of 4 for an audible saturated tone. A convenience wrapper over
   * {@link createWaveshaper}; caller-supplied options override the defaults.
   */
  createDistortion(options: WaveshaperOptions = {}): WaveshaperEffect {
    return new WaveshaperEffect(this, { drive: 4, shape: 1, ...options });
  }

  /**
   * Creates a {@link ModulatedDelayEffect} preset as a DELAY / ECHO — Dattorro's
   * unified modulated-delay circuit (JAES 1997, Fig. 36) with the modulation OFF
   * (`depth: 0`, `rate: 0`). Echo knobs (Table 6): full dry `blend: 1` plus a
   * unity wet tap `feedforward: 1`; feedback defaults to 0 (a single tap) but is
   * caller-configurable for a regenerating echo (|feedback| < 1, Table 6). The
   * 250 ms tap sits in the echo range (Table 7). All knobs are exposed.
   */
  createDelay(options: ModulatedDelayOptions = {}): ModulatedDelayEffect {
    return new ModulatedDelayEffect(this, {
      blend: 1,
      feedforward: 1,
      feedback: 0,
      delayTime: 250,
      depth: 0,
      rate: 0,
      ...options,
    });
  }

  /**
   * Creates a {@link ModulatedDelayEffect} preset as a (white) CHORUS — Dattorro
   * Table 6 white-chorus knobs `blend: 0.7071`, `feedforward: 1`,
   * `feedback: 0.7071` (blend = feedback, feedforward = 1, the negative-feedback
   * path that minimizes the spectral aberration of a plain dry+wet chorus). A
   * 9 ms tap modulated 4 ms at 0.5 Hz sits in the chorus range (Table 7).
   *
   * NOTE: Dattorro's white chorus (p.776) combines this negative-feedback path
   * with ALLPASS fractional-delay interpolation. This implementation uses the
   * white-chorus knob settings but substitutes cubic-Lagrange interpolation
   * (Laakso 1996) — transient-safe under modulation (Laakso p.52), trading some
   * high-frequency trough depth versus a true allpass-interpolated white chorus.
   */
  createChorus(options: ModulatedDelayOptions = {}): ModulatedDelayEffect {
    return new ModulatedDelayEffect(this, {
      blend: DATTORRO_INV_SQRT2,
      feedforward: 1,
      feedback: DATTORRO_INV_SQRT2,
      delayTime: 9,
      depth: 4,
      rate: 0.5,
      ...options,
    });
  }

  /**
   * Creates a {@link ModulatedDelayEffect} preset as a FLANGER — Dattorro Table 6
   * flanger knobs `blend: 0.7071`, `feedforward: 0.7071` (blend = feedforward for
   * the deepest comb trough), `feedback: -0.7071` (negative feedback deepens the
   * troughs). A short 5 ms tap swept 4 ms at 0.25 Hz gives the classic flange
   * (Table 7).
   */
  createFlanger(options: ModulatedDelayOptions = {}): ModulatedDelayEffect {
    return new ModulatedDelayEffect(this, {
      blend: DATTORRO_INV_SQRT2,
      feedforward: DATTORRO_INV_SQRT2,
      feedback: -DATTORRO_INV_SQRT2,
      delayTime: 5,
      depth: 4,
      rate: 0.25,
      ...options,
    });
  }

  /**
   * Creates a {@link ModulatedDelayEffect} preset as a VIBRATO — Dattorro Table 6
   * vibrato knobs `blend: 0`, `feedforward: 1`, `feedback: 0` (100% wet, no dry
   * path, no feedback), so only the pitch-modulated delayed signal is heard. A
   * 5 ms tap swept 3 ms at 5 Hz (Table 7).
   */
  createVibrato(options: ModulatedDelayOptions = {}): ModulatedDelayEffect {
    return new ModulatedDelayEffect(this, {
      blend: 0,
      feedforward: 1,
      feedback: 0,
      delayTime: 5,
      depth: 3,
      rate: 5,
      ...options,
    });
  }

  /**
   * Creates a {@link ModulatedDelayEffect} preset as DOUBLING ("double tracking")
   * — Dattorro Table 6 doubling knobs `blend: 0.7071`, `feedforward: 0.7071`,
   * `feedback: 0` (no feedback). A ~20 ms tap (Table 7 doubling nominal) with a
   * gentle 1 ms / 0.4 Hz wobble fattens a single take into two.
   */
  createDoubling(options: ModulatedDelayOptions = {}): ModulatedDelayEffect {
    return new ModulatedDelayEffect(this, {
      blend: DATTORRO_INV_SQRT2,
      feedforward: DATTORRO_INV_SQRT2,
      feedback: 0,
      delayTime: 20,
      depth: 1,
      rate: 0.4,
      ...options,
    });
  }

  /**
   * Creates a {@link PhaserEffect} — a classic MXR/Univibe-style phase shifter: a
   * cascade of first-order allpass sections at a common LFO-swept break frequency
   * summed additively with the dry signal to sweep notches through the spectrum
   * (Smith STAN-M-21; PASP §8.9). Two allpass sections per notch (default 4
   * sections = 2 notches). Add the returned effect to a {@link Bus} via
   * `bus.addFilter(effect)`.
   */
  createPhaser(options: PhaserOptions = {}): PhaserEffect {
    return new PhaserEffect(this, options);
  }

  /**
   * Creates a {@link TremoloEffect} — LFO-driven amplitude modulation (a VCA
   * swung by a low-frequency oscillator). The gain swings between (1 - depth)
   * and 1, never inverting (a true tremolo, not ring modulation). Anchored to
   * standard AM theory, Dattorro 1997 (p.776) for the quadrature stereo LFO, and
   * Mitcheltree et al. (DAFx23) for the LFO-driven-effect framing. `shape` selects
   * the LFO waveform (0 = sine, 1 = triangle, 2 = square); `stereoPhase` offsets
   * the per-channel LFO. Add the returned effect to a {@link Bus} via
   * `bus.addFilter(effect)`.
   */
  createTremolo(options: TremoloOptions = {}): TremoloEffect {
    return new TremoloEffect(this, options);
  }

  /**
   * Creates a {@link TremoloEffect} preset as an AUTO-PAN — a tremolo with
   * `stereoPhase: 180`, so the left and right channel gains modulate in
   * anti-phase (the sound swings hard between the speakers). The 180-deg
   * per-channel LFO offset is Dattorro's stereo-modulation convention (p.776). A
   * convenience wrapper over {@link createTremolo}; caller options override the
   * preset.
   */
  createAutoPan(options: TremoloOptions = {}): TremoloEffect {
    return new TremoloEffect(this, { stereoPhase: 180, ...options });
  }

  /**
   * Creates a Hilbert-transform single-sideband frequency shifter (Wardle,
   * DAFx-98). Unlike pitch shifting, every partial moves by the same signed
   * number of hertz, deliberately breaking harmonic ratios.
   */
  createFrequencyShifter(options: FrequencyShifterOptions = {}): FrequencyShifterEffect {
    return new FrequencyShifterEffect(this, options);
  }

  /**
   * Creates the spectral-delay SSB barberpole effect from Esqueda, Valimaki &
   * Parker (DAFx-15, Fig. 12): notches travel indefinitely in the direction
   * selected by the sign of `rate`, rather than reversing like a normal phaser.
   */
  createBarberpole(options: BarberpoleOptions = {}): BarberpoleEffect {
    return new BarberpoleEffect(this, options);
  }

  /** Adds two identity-phase-locked pitch voices in one Laroche-Dolson STFT pass. */
  createHarmonizer(options: HarmonizerOptions = {}): HarmonizerEffect {
    return new HarmonizerEffect(this, options);
  }

  /**
   * Captures and sustains a spectrum while continuing each bin's measured
   * phase advance. Automate the `freeze` AudioParam to capture/release.
   */
  createSpectralFreeze(options: SpectralFreezeOptions = {}): SpectralFreezeEffect {
    return new SpectralFreezeEffect(this, options);
  }

  /** Creates an explicit-stereo sparse decorrelator with transient protection. */
  createStereoWidener(options: StereoWidenerOptions = {}): StereoWidenerEffect {
    return new StereoWidenerEffect(this, options);
  }

  /** The default audio context for this Cacophony instance (used by
   * {@link FoaDecoder} when no explicit context is supplied). */
  defaultContext(): BaseContext {
    return this.context;
  }

  /**
   * Creates a {@link FoaDecoder} — a standalone first-order ambisonic (FOA) ->
   * binaural FORMAT CONVERTER built from native Web Audio nodes (no worklet).
   * It decodes a 4-channel ACN/SN3D `[W, Y, Z, X]` signal to headphone stereo
   * via the per-SH-channel HRIR decode of Ahrens 2022 (eq.31), using
   * Omnitone's WY/ZX 2-stereo-ConvolverNode packing and the bundled order-1
   * SH-HRIR.
   *
   * It is 4-channel-in / 2-channel-out; this method returns the explicit
   * endpoint object for custom graph wiring:
   * feed FOA into `decoder.input` (4-ch) and route `decoder.output` (2-ch
   * stereo) downstream:
   * ```ts
   *   const decoder = await cacophony.createFoaDecoder();
   *   foaSource.connect(decoder.input);
   *   decoder.output.connect(bus.input); // or context.destination
   * ```
   * Build is async (the bundled HRIR is fetched + decoded). Pair it with
   * {@link encodeMonoToFoaSN3D} (clean, physically correct) or with
   * `createStereoToBFormatNode` (the perceptual, approximate stereo-upmix path).
   */
  async createFoaDecoder(options: FoaDecoderOptions = {}, context?: BaseContext): Promise<FoaDecoder> {
    return FoaDecoder.create(this, options, context);
  }

  /**
   * Creates a bus-filter wrapper around {@link FoaDecoder}. Use this on a
   * dedicated 4-channel ACN/SN3D FOA bus, typically as the first and only
   * filter that converts that bus to stereo binaural output. For custom manual
   * wiring, use {@link createFoaDecoder} instead.
   */
  createFoaDecoderEffect(options: FoaDecoderOptions = {}): FoaDecoderEffect {
    return new FoaDecoderEffect(this, options);
  }

  /**
   * Creates an ITU-R BS.1770-5 {@link LoudnessMeter} that TAPS the output of a
   * target node without altering the audible path. The meter reports momentary
   * (400 ms), short-term (3 s), and gated integrated loudness in LKFS/LUFS, plus
   * true-peak level in dBTP (Annex 2 4× oversampling).
   *
   * The tap is a BRANCH: the target's output is connected to the metering
   * worklet in ADDITION to its existing forward edge, and the worklet's output
   * is routed through an owned zero-gain sink to keep the branch silent and live.
   * By default the target is the
   * master bus output (`master.output`), measuring everything that reaches the
   * destination — the integrated-loudness target. Pass a {@link Bus} to meter
   * one bus's output, or any {@link AudioNode} to meter that node.
   *
   * Lazily registers the `loudness-meter` worklet module (no-op if already
   * loaded) on the target's context, then constructs the node and branch-taps.
   *
   * @param target Node or bus whose output to meter. Defaults to the master bus.
   * @returns A {@link LoudnessMeter} handle exposing the live readings.
   */
  async createLoudnessMeter(target: Bus | AudioNode = this.master): Promise<LoudnessMeter> {
    const sourceNode: AudioNode = target instanceof Bus ? target.output : target;
    // Load AND construct the worklet on the SOURCE node's OWN context, not always
    // `this.context`. A caller may pass an AudioNode (or Bus) living on a
    // different BaseContext; building the meter on this host's context would
    // cross-connect two contexts (illegal in Web Audio). The source node carries
    // its full context at runtime (native + standardized-audio-context both do);
    // the structural `AudioNode.context` type is narrowed, so widen it here.
    const targetContext = (sourceNode.context as BaseContext | undefined) ?? this.context;
    await this.loadAudioWorkletModule(
      WORKLETS.loudnessMeter.name,
      WORKLETS.loudnessMeter.url,
      undefined,
      targetContext,
    );
    const node = await this.createWorkletNode(
      WORKLETS.loudnessMeter.name,
      WORKLETS.loudnessMeter.url,
      undefined,
      { numberOfInputs: 1, numberOfOutputs: 1 },
      targetContext,
    );
    const silentSink = targetContext.createGain();
    return new LoudnessMeter(node, sourceNode, silentSink, targetContext.destination);
  }

  /**
   * Creates a new {@link Bus}. If `name` is provided, the bus is registered
   * so {@link getBus} can look it up by name. Anonymous buses (no name) are
   * not registered and cannot be retrieved by name.
   *
   * @throws if a named bus with the same name already exists, or if the
   *   reserved name 'master' is used (the master bus is auto-created).
   */
  createBus(name?: string): Bus {
    if (name === "master") {
      throw new Error("The name 'master' is reserved — use cacophony.master to access the master bus.");
    }
    if (name !== undefined && this._busRegistry.has(name)) {
      throw new Error(`A bus named '${name}' already exists.`);
    }
    const onDestroy = name !== undefined ? () => this._busRegistry.delete(name) : undefined;
    const bus = new Bus(this.context, name ?? null, undefined, onDestroy);
    if (name !== undefined) {
      this._busRegistry.set(name, bus);
    }
    // New buses default-route to master so audio flows out somewhere unless
    // the user wires it elsewhere. master is intentionally not destroyable.
    bus.connect(this.master);
    return bus;
  }

  /**
   * Retrieves a bus by name from the named-bus registry. Returns `undefined`
   * if no bus with that name exists. The special name `'master'` returns
   * the auto-created master bus.
   */
  getBus(name: string): Bus | undefined {
    if (name === "master") {
      return this.master;
    }
    return this._busRegistry.get(name);
  }

  /**
   * Returns the names of every registered named bus. Anonymous buses are
   * not included. The master bus's name (`'master'`) is included.
   */
  listBuses(): string[] {
    return ["master", ...this._busRegistry.keys()];
  }

  createSplitter(numChannels: number = 2): ChannelSplitterNode {
    if (!this.context.createChannelSplitter) {
      throw new Error("ChannelSplitterNode not supported");
    }
    return this.context.createChannelSplitter(numChannels);
  }

  createMerger(numChannels: number = 2): ChannelMergerNode {
    if (!this.context.createChannelMerger) {
      throw new Error("ChannelMergerNode not supported");
    }
    return this.context.createChannelMerger(numChannels);
  }

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
    panner.coneInnerAngle = coneInnerAngle ?? 360;
    panner.coneOuterAngle = coneOuterAngle ?? 360;
    panner.coneOuterGain = coneOuterGain ?? 0;
    panner.distanceModel = distanceModel ?? "inverse";
    panner.maxDistance = maxDistance ?? 10000;
    panner.channelCount = channelCount ?? 2;
    panner.channelCountMode = channelCountMode ?? "clamped-max";
    panner.channelInterpretation = channelInterpretation ?? "speakers";
    panner.panningModel = panningModel ?? "HRTF";
    panner.refDistance = refDistance ?? 1;
    panner.rolloffFactor = rolloffFactor ?? 1;
    panner.positionX.value = positionX ?? 0;
    panner.positionY.value = positionY ?? 0;
    panner.positionZ.value = positionZ ?? 0;
    panner.orientationX.value = orientationX ?? 0;
    panner.orientationY.value = orientationY ?? 0;
    panner.orientationZ.value = orientationZ ?? 0;
    return panner;
  }

  /**
   * Suspends the audio context.
   *
   * Resolves after the underlying AudioContext transition completes, then
   * emits the `suspend` event. If the context is already suspended (per this
   * instance's view), resolves immediately as a no-op. If the underlying
   * `suspend()` call rejects, the rejection is propagated and no event fires.
   */
  async pause(): Promise<void> {
    if (!this.context.suspend) {
      return;
    }
    if (this.suspendState === "suspended") {
      return;
    }
    await this.context.suspend();
    this.suspendState = "suspended";
    this.emit("suspend", undefined);
  }

  /**
   * Resumes the audio context.
   * This method is required to resume the audio context on mobile devices.
   * On desktop, the audio context will automatically resume when a sound is played.
   *
   * Resolves after the underlying AudioContext transition completes, then
   * emits the `resume` event. If the underlying `resume()` call rejects, the
   * rejection is propagated and no event fires.
   */
  async resume(): Promise<void> {
    if (!this.context.resume) {
      return;
    }
    await this.context.resume();
    this.suspendState = "running";
    this.emit("resume", undefined);
  }

  setGlobalVolume(volume: number) {
    if (this.muted) {
      this.prevVolume = volume;
      return;
    }
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
      this.isMuted = true;
      if (this.globalGainNode.gain.value !== 0) {
        this.globalGainNode.gain.value = 0;
        this.emit("volumeChange", 0);
      }
      this.emit("mute", undefined);
    }
  }

  unmute() {
    if (this.muted) {
      this.isMuted = false;
      this.setGlobalVolume(this.prevVolume);
      this.emit("unmute", undefined);
    }
  }

  get muted(): boolean {
    return this.isMuted;
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

  async getMicrophoneStream(options: MicrophoneStreamOptions = {}): Promise<MicrophoneStream> {
    return MicrophoneStream.request(this.context, this.globalGainNode, options, this);
  }

  get listenerOrientation(): Orientation {
    return {
      forward: [...this.cachedListenerForward],
      up: [...this.cachedListenerUp],
    };
  }

  set listenerOrientation(orientation: Orientation) {
    const forward: Position = [orientation.forward[0], orientation.forward[1], orientation.forward[2]];
    const up: Position = [orientation.up[0], orientation.up[1], orientation.up[2]];
    writeListenerOrientation(this.listener, forward, up);
    this.cachedListenerForward = forward;
    this.cachedListenerUp = up;
  }

  get listenerUpOrientation(): Position {
    return [...this.cachedListenerUp];
  }

  set listenerUpOrientation(up: Position) {
    const nextUp: Position = [up[0], up[1], up[2]];
    writeListenerOrientation(this.listener, this.cachedListenerForward, nextUp);
    this.cachedListenerUp = nextUp;
  }

  get listenerForwardOrientation(): Position {
    return [...this.cachedListenerForward];
  }

  set listenerForwardOrientation(forward: Position) {
    const nextForward: Position = [forward[0], forward[1], forward[2]];
    writeListenerOrientation(this.listener, nextForward, this.cachedListenerUp);
    this.cachedListenerForward = nextForward;
  }

  get listenerPosition(): Position {
    return [...this.cachedListenerPosition];
  }

  set listenerPosition(position: Position) {
    const nextPosition: Position = [position[0], position[1], position[2]];
    writeListenerPosition(this.listener, nextPosition, this.context.currentTime);
    this.cachedListenerPosition = nextPosition;
  }
}
