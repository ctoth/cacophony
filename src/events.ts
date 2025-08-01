import { BasePlayback } from "basePlayback";
import { Playback } from "playback";
import { SynthPlayback } from "./synthPlayback";

export interface BaseAudioEvents {
  play: BasePlayback;
  stop: void;
  pause: void;
  resume: void;
  ended: void;
  volumeChange: number;
  error: PlaybackErrorEvent;
}

export interface SoundEvents extends BaseAudioEvents {
  loopEnd: void;
  rateChange: number;
  soundError: SoundErrorEvent;
}

export interface PlaybackEvents extends BaseAudioEvents {
  seek: number;
}

export interface SynthEvents extends Omit<BaseAudioEvents, 'play'> {
  play: SynthPlayback;
  frequencyChange: number;
  typeChange: OscillatorType;
  detuneChange: number;
}

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
}

// Loading Event Types
export interface LoadingStartEvent {
  url: string;
  timestamp: number;
}

export interface LoadingProgressEvent {
  url: string;
  loaded: number;
  total: number | null;
  progress: number; // 0-1, or -1 if total unknown
  timestamp: number;
}

export interface LoadingCompleteEvent {
  url: string;
  duration: number;
  size: number;
  timestamp: number;
}

export interface LoadingErrorEvent {
  url: string;
  error: Error;
  errorType: 'network' | 'decode' | 'abort' | 'unknown';
  timestamp: number;
}

// Error Event Types
export interface PlaybackErrorEvent {
  error: Error;
  errorType: 'context' | 'source' | 'decode' | 'unknown';
  timestamp: number;
  recoverable: boolean;
}

export interface SoundErrorEvent {
  url?: string;
  error: Error;
  errorType: 'load' | 'playback' | 'context' | 'unknown';
  timestamp: number;
  recoverable: boolean;
}

// Cache Event Types
export interface CacheHitEvent {
  url: string;
  cacheType: 'memory' | 'browser' | 'conditional';
  timestamp: number;
}

export interface CacheMissEvent {
  url: string;
  reason: 'not-found' | 'expired' | 'invalid';
  timestamp: number;
}

export interface CacheErrorEvent {
  url: string;
  error: Error;
  operation: 'get' | 'set' | 'delete' | 'validate';
  timestamp: number;
}

// Event Callback Types
export type LoadingEventCallback = {
  onLoadingStart?: (event: LoadingStartEvent) => void;
  onLoadingProgress?: (event: LoadingProgressEvent) => void;
  onLoadingComplete?: (event: LoadingCompleteEvent) => void;
  onLoadingError?: (event: LoadingErrorEvent) => void;
};

export type ErrorEventCallback = {
  onPlaybackError?: (event: PlaybackErrorEvent) => void;
  onSoundError?: (event: SoundErrorEvent) => void;
};

export type CacheEventCallback = {
  onCacheHit?: (event: CacheHitEvent) => void;
  onCacheMiss?: (event: CacheMissEvent) => void;
  onCacheError?: (event: CacheErrorEvent) => void;
};

// Combined Event Callback Interface
export interface AudioEventCallbacks extends LoadingEventCallback, ErrorEventCallback, CacheEventCallback {}
