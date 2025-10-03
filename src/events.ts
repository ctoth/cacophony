import { BasePlayback } from "./basePlayback";
import { Playback } from "./playback";
import { SynthPlayback } from "./synthPlayback";
import type { Sound } from "./sound";
import type { Synth } from "./synth";

/**
 * Base events for all audio objects.
 */
export interface BaseAudioEvents {
  play: BasePlayback;
  stop: void;
  pause: void;
  resume: void;
  ended: void;
  volumeChange: number;
  error: PlaybackErrorEvent;
}

/**
 * Sound-specific events.
 */
export interface SoundEvents extends BaseAudioEvents {
  loopEnd: void;
  rateChange: number;
  soundError: SoundErrorEvent;
}

/**
 * Playback-specific events.
 */
export interface PlaybackEvents extends BaseAudioEvents {
  seek: number;
}

/**
 * Synthesizer-specific events.
 */
export interface SynthEvents extends Omit<BaseAudioEvents, 'play'> {
  play: SynthPlayback;
  frequencyChange: number;
  typeChange: OscillatorType;
  detuneChange: number;
}

/**
 * Global playback event fired when any Sound or Synth plays/stops/pauses.
 */
export interface GlobalPlaybackEvent {
  source: Sound | Synth;
  timestamp: number;
}

/**
 * Global Cacophony events including loading and cache operations.
 */
export interface CacophonyEvents {
  volumeChange: number;
  mute: void;
  unmute: void;
  suspend: void;
  resume: void;
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
}

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
  errorType: 'network' | 'decode' | 'abort' | 'unknown';
  timestamp: number;
}

/**
 * Playback error with recovery information.
 */
export interface PlaybackErrorEvent {
  error: Error;
  errorType: 'context' | 'source' | 'decode' | 'unknown';
  timestamp: number;
  recoverable: boolean;
}

/**
 * Sound error with recovery information.
 */
export interface SoundErrorEvent {
  url?: string;
  error: Error;
  errorType: 'load' | 'playback' | 'context' | 'unknown';
  timestamp: number;
  recoverable: boolean;
}

/**
 * Cache hit from memory, browser cache, or 304 response.
 */
export interface CacheHitEvent {
  url: string;
  cacheType: 'memory' | 'browser' | 'conditional';
  timestamp: number;
}

/**
 * Cache miss requiring network fetch.
 */
export interface CacheMissEvent {
  url: string;
  reason: 'not-found' | 'expired' | 'invalid';
  timestamp: number;
}

/**
 * Cache operation error.
 */
export interface CacheErrorEvent {
  url: string;
  error: Error;
  operation: 'get' | 'set' | 'delete' | 'validate';
  timestamp: number;
}

/**
 * Loading event callbacks for cache operations.
 */
export type LoadingEventCallback = {
  onLoadingStart?: (event: LoadingStartEvent) => void;
  onLoadingProgress?: (event: LoadingProgressEvent) => void;
  onLoadingComplete?: (event: LoadingCompleteEvent) => void;
  onLoadingError?: (event: LoadingErrorEvent) => void;
};

/**
 * Error event callbacks.
 */
export type ErrorEventCallback = {
  onPlaybackError?: (event: PlaybackErrorEvent) => void;
  onSoundError?: (event: SoundErrorEvent) => void;
};

/**
 * Cache event callbacks.
 */
export type CacheEventCallback = {
  onCacheHit?: (event: CacheHitEvent) => void;
  onCacheMiss?: (event: CacheMissEvent) => void;
  onCacheError?: (event: CacheErrorEvent) => void;
};

/**
 * Combined event callbacks for cache operations.
 */
export interface AudioEventCallbacks extends LoadingEventCallback, ErrorEventCallback, CacheEventCallback {}
