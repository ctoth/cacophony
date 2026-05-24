import { installAutoplayUnlock } from "./autoplayUnlock";
import dattorroReverbProcessorWorkletUrl from "./bundles/dattorro-reverb-bundle.js?url";
import phaseVocoderProcessorWorkletUrl from "./bundles/phase-vocoder-bundle.js?url";
import stereoToBFormatProcessorWorkletUrl from "./bundles/stereo-to-bformat-bundle.js?url";
import { AudioCache, type ICache } from "./cache";
import type {
  AudioBuffer,
  AudioListener,
  AudioNode,
  AudioWorkletNode,
  BaseContext,
  BiquadFilterNode,
  ChannelMergerNode,
  ChannelSplitterNode,
  GainNode,
  PannerNode,
} from "./context";
import { Bus } from "./bus";
import { type CacophonyEffect, markAsCacophonyBiquad, ReverbEffect, type ReverbOptions, ShareEffect } from "./effects";
import { TypedEventEmitter } from "./eventEmitter";
import type { CacophonyEvents } from "./events";
import { Group } from "./group";
import { MediaStreamSound, type MediaStreamSoundOptions } from "./mediaStream";
import { MicrophoneStream } from "./microphone";
import type { ThreeDOptions } from "./pannerMixin";
import { Sound } from "./sound";
import { Synth } from "./synth";

export type SoundType = "html" | "streaming" | "buffer" | "oscillator";

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
  private prevVolume: number = 1;
  private loadedAudioWorklets: Set<string> = new Set();
  private finalizationRegistry: FinalizationRegistry<SoundCleanupHoldings>;
  private eventEmitter: TypedEventEmitter<CacophonyEvents> = new TypedEventEmitter<CacophonyEvents>();
  private cache: ICache;
  private createAudioWorkletNode: (context: BaseContext, name: string, options?: AudioWorkletNodeOptions) => any;
  /**
   * Named-bus registry. Populated by {@link createBus} when a name is
   * supplied; entries are removed by the bus's onDestroy hook.
   */
  private _busRegistry: Map<string, Bus> = new Map();
  // Tracks the lifecycle state we have explicitly transitioned to. This avoids
  // duplicate wrapper-driven suspend calls, but resume() still delegates because
  // the underlying AudioContext can be suspended externally.
  private suspendState: "unknown" | "running" | "suspended" = "unknown";
  // Cleanup function for the autoplay-unlock listeners. No-op when listeners
  // were not installed (autoUnlock disabled, offline context, non-browser,
  // or context not in 'suspended' state at construction time).
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
    this.master = new Bus(this.context, "master", this.globalGainNode);
    this.master.output.connect(this.context.destination);
    this.cache = cache ?? new AudioCache();
    this.createAudioWorkletNode =
      runtimeOptions.createAudioWorkletNode ??
      ((workletContext, name, options) => new AudioWorkletNode(workletContext as any, name, options));

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

    // Install autoplay unlock — guarded against offline contexts, non-browser
    // environments, and non-suspended contexts inside installAutoplayUnlock
    // itself. Offline contexts are filtered out here because they cannot
    // suspend in the same way and an unlock makes no sense for them.
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
   * @returns A Cacophony instance backed by OfflineAudioContext
   */
  static createOffline(options: OfflineOptions, cache?: ICache): Cacophony {
    const offlineContext =
      options.context ?? new OfflineAudioContext(options.numberOfChannels, options.length, options.sampleRate);
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
      await this.loadStereoToBFormatWorklet(signal);
      await this.loadDattorroReverb(signal);
    } else {
      console.warn("AudioWorklet not supported");
    }
  }

  async loadStereoToBFormatWorklet(signal?: AbortSignal): Promise<void> {
    await this.loadAudioWorkletModule("stereo-to-bformat", stereoToBFormatProcessorWorkletUrl, signal);
  }

  /**
   * Idempotently registers the DattorroReverb AudioWorkletProcessor on this
   * context. Safe to call repeatedly — subsequent calls short-circuit via
   * the {@link loadedAudioWorklets} set used by
   * {@link loadAudioWorkletModule}.
   *
   * @param signal Optional abort signal forwarded to the module load.
   * @param context Optional BaseContext to load the worklet on. Defaults to
   *   the host Cacophony instance's `context`. Supplied so a
   *   {@link ReverbEffect} added to a bus whose context is NOT this host's
   *   own (cross-context use) can load the worklet on the right context.
   */
  async loadDattorroReverb(signal?: AbortSignal, context?: BaseContext): Promise<void> {
    await this.loadAudioWorkletModule(
      "dattorro-reverb",
      dattorroReverbProcessorWorkletUrl,
      signal,
      context,
    );
  }

  /**
   * Constructs a DattorroReverb AudioWorkletNode. Caller is expected to have
   * loaded the module already (via {@link loadDattorroReverb} or by reaching
   * here through {@link ReverbEffect.build}). Uses the same construct/fallback
   * path as {@link createWorkletNode}.
   *
   * @param options AudioWorkletNode construction options.
   * @param context Optional BaseContext to construct on. Defaults to the
   *   host Cacophony instance's `context`. See {@link loadDattorroReverb}
   *   for the cross-context rationale.
   */
  async createDattorroReverbNode(
    options: AudioWorkletNodeOptions,
    context?: BaseContext,
  ): Promise<AudioWorkletNode> {
    return this.createWorkletNode(
      "dattorro-reverb",
      dattorroReverbProcessorWorkletUrl,
      undefined,
      options,
      context,
    );
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
      console.info(`${WORKLET_LOG_PREFIX} construct succeeded`, {
        name,
        loaded: this.loadedAudioWorklets.has(name),
      });
      return node;
    } catch (err) {
      console.warn(`${WORKLET_LOG_PREFIX} construct failed`, {
        name,
        loaded: this.loadedAudioWorklets.has(name),
        error: err,
      });
      try {
        await this.loadAudioWorkletModule(name, url, signal, ctx);
      } catch (err) {
        console.error(`${WORKLET_LOG_PREFIX} load failed`, {
          name,
          error: err,
        });
        throw err; // Preserve original error (including AbortError)
      }

      try {
        const node = this.createAudioWorkletNode(ctx, name, options);
        console.info(`${WORKLET_LOG_PREFIX} construct after load succeeded`, { name });
        return node;
      } catch (err) {
        console.error(`${WORKLET_LOG_PREFIX} construct after load failed`, {
          name,
          error: err,
        });
        throw err;
      }
    }
  }

  async createStereoToBFormatNode(signal?: AbortSignal): Promise<AudioWorkletNode> {
    return this.createWorkletNode("stereo-to-bformat", stereoToBFormatProcessorWorkletUrl, signal, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [4],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
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
    if (this.loadedAudioWorklets.has(name)) {
      console.info(`${WORKLET_LOG_PREFIX} load skipped`, { name });
      return;
    }
    console.info(`${WORKLET_LOG_PREFIX} addModule start`, {
      name,
      url,
      aborted: signal?.aborted ?? false,
    });
    try {
      await ctx.audioWorklet.addModule(url, {
        credentials: "same-origin",
        ...(signal && { signal }),
      });
      this.loadedAudioWorklets.add(name);
      console.info(`${WORKLET_LOG_PREFIX} addModule resolved`, { name });
    } catch (err) {
      console.error(`${WORKLET_LOG_PREFIX} addModule rejected`, {
        name,
        error: err,
      });
      throw err;
    }
  }

  private createAbortError(): DOMException {
    return new DOMException("Operation was aborted", "AbortError");
  }

  private createMediaSound(
    url: string,
    soundType: "html" | "streaming",
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

  private async loadBufferSound(
    url: string,
    soundType: SoundType,
    panType: PanType,
    signal?: AbortSignal,
  ): Promise<Sound> {
    const buffer = await this.cache.getAudioBuffer(this.context, url, signal, {
      onLoadingStart: (event) => this.emitAsync("loadingStart", event),
      onLoadingProgress: (event) => this.emitAsync("loadingProgress", event),
      onLoadingComplete: (event) => this.emitAsync("loadingComplete", event),
      onLoadingError: (event) => this.emitAsync("loadingError", event),
      onCacheHit: (event) => this.emitAsync("cacheHit", event),
      onCacheMiss: (event) => this.emitAsync("cacheMiss", event),
      onCacheError: (event) => this.emitAsync("cacheError", event),
    });
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
   * Creates a streaming Sound instance from a URL.
   *
   * @param url - URL string to stream audio from
   * @param signal - Optional AbortSignal to cancel the operation
   * @returns Promise that resolves to a Sound instance for streaming
   */
  async createStream(url: string, signal?: AbortSignal): Promise<Sound> {
    return this.createMediaSound(url, "streaming", "HRTF", signal);
  }

  createMediaStreamSound(stream: MediaStream, options?: MediaStreamSoundOptions): MediaStreamSound {
    return new MediaStreamSound(stream, this.context, this.globalGainNode, options, this);
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

  async getMicrophoneStream(): Promise<MicrophoneStream> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return new MicrophoneStream(this.context, stream);
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
