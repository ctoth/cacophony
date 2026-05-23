import type { BasePlayback } from "./basePlayback";
import type { BaseSound, FadeType } from "./cacophony";
import type { SynthPlayback } from "./synthPlayback";

/**
 * Base events for all audio objects.
 */
export interface FadeStartEvent {
  target: number;
  duration: number;
  type: FadeType;
}

export type BaseAudioEvents = {
  play: BasePlayback;
  stop: undefined;
  pause: undefined;
  resume: undefined;
  ended: undefined;
  volumeChange: number;
  error: PlaybackErrorEvent;
  fadeStart: FadeStartEvent;
  fadeEnd: undefined;
  fadeCancel: undefined;
};

/**
 * Sound-specific events.
 */
export type SoundEvents = BaseAudioEvents & {
  loopEnd: undefined;
  rateChange: number;
  soundError: SoundErrorEvent;
};

/**
 * Playback-specific events.
 */
export type PlaybackEvents = BaseAudioEvents & {
  seek: number;
};

/**
 * Synthesizer-specific events.
 */
export type SynthEvents = Omit<BaseAudioEvents, "play"> & {
  play: SynthPlayback;
  frequencyChange: number;
  typeChange: OscillatorType;
  detuneChange: number;
};

/**
 * Global playback event fired when any sound-producing entity plays/stops/pauses.
 */
export interface GlobalPlaybackEvent {
  source: BaseSound;
  timestamp: number;
}

/**
 * Global Cacophony events including loading and cache operations.
 */
export type CacophonyEvents = {
  volumeChange: number;
  mute: undefined;
  unmute: undefined;
  suspend: undefined;
  resume: undefined;
  loadingStart: LoadingStartEvent;
  loadingProgress: LoadingProgressEvent;
  loadingComplete: LoadingCompleteEvent;
  loadingError: LoadingErrorEvent;
  cacheHit: CacheHitEvent;
  cacheMiss: CacheMissEvent;
  cacheError: CacheErrorEvent;
  globalPlay: GlobalPlaybackEvent;
  globalStop: GlobalPlaybackEvent;
  globalPause: GlobalPlaybackEvent;
};

/**
 * Fired when loading starts. Use for loading spinners.
 */
export interface LoadingStartEvent {
  url: string;
  timestamp: number;
}

/**
 * Progress updates. total=null means unknown size.
 * progress=-1 means indeterminate.
 */
export interface LoadingProgressEvent {
  url: string;
  loaded: number;
  total: number | null;
  progress: number; // 0-1, or -1 if total unknown
  timestamp: number;
}

/**
 * Fired when loading completes successfully.
 */
export interface LoadingCompleteEvent {
  url: string;
  duration: number;
  size: number;
  timestamp: number;
}

/**
 * Fired when loading fails.
 */
export interface LoadingErrorEvent {
  url: string;
  error: Error;
  errorType: "network" | "decode" | "abort" | "unknown";
  timestamp: number;
}

/**
 * Playback error with recovery information.
 */
export interface PlaybackErrorEvent {
  error: Error;
  errorType: "context" | "source" | "decode" | "unknown";
  timestamp: number;
  recoverable: boolean;
}

/**
 * Sound error with recovery information.
 */
export interface SoundErrorEvent {
  url?: string;
  error: Error;
  errorType: "load" | "playback" | "context" | "unknown";
  timestamp: number;
  recoverable: boolean;
}

/**
 * Cache hit from memory, browser cache, or 304 response.
 */
export interface CacheHitEvent {
  url: string;
  cacheType: "memory" | "browser" | "conditional";
  timestamp: number;
}

/**
 * Cache miss requiring network fetch.
 */
export interface CacheMissEvent {
  url: string;
  reason: "not-found" | "expired" | "invalid";
  timestamp: number;
}

/**
 * Cache operation error.
 */
export interface CacheErrorEvent {
  url: string;
  error: Error;
  operation: "get" | "set" | "delete" | "validate";
  timestamp: number;
}

/**
 * Maps an event-payload record to its `on<EventName>` callback record.
 * Each callback is optional and takes the payload as its sole argument.
 */
type EventCallbacks<TMap> = {
  [K in keyof TMap as `on${Capitalize<string & K>}`]?: (event: TMap[K]) => void;
};

/**
 * Loading event callbacks for cache operations.
 */
export type LoadingEventCallback = EventCallbacks<
  Pick<CacophonyEvents, "loadingStart" | "loadingProgress" | "loadingComplete" | "loadingError">
>;

/**
 * Error event callbacks.
 */
export type ErrorEventCallback = EventCallbacks<{
  playbackError: PlaybackErrorEvent;
  soundError: SoundErrorEvent;
}>;

/**
 * Cache event callbacks.
 */
export type CacheEventCallback = EventCallbacks<Pick<CacophonyEvents, "cacheHit" | "cacheMiss" | "cacheError">>;

/**
 * Combined event callbacks for loading, error, and cache operations.
 */
export interface AudioEventCallbacks extends LoadingEventCallback, ErrorEventCallback, CacheEventCallback {}
