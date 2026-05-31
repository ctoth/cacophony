// Public API of cacophony. Every name re-exported here is part of the package's
// supported surface. Do NOT add `export *` — every value/type must be listed
// explicitly so additions to internal modules cannot leak out without review.

export type { BusConnectionTarget } from "./bus";
export { Bus } from "./bus";
export { AudioCache } from "./cache";
export type {
  BaseSound,
  FadeType,
  LoopCount,
  OfflineOptions,
  Orientation,
  PanType,
  PlayOptions,
  Position,
  RuntimeOptions,
  SoundCleanupHoldings,
  SoundType,
} from "./cacophony";
export { Cacophony } from "./cacophony";
export type {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioListener,
  AudioNode,
  AudioParam,
  AudioWorklet,
  AudioWorkletNode,
  BaseContext,
  BiquadFilterNode,
  ChannelMergerNode,
  ChannelSplitterNode,
  GainNode,
  MediaElementSourceNode,
  MediaStreamAudioSourceNode,
  OscillatorNode,
  PannerNode,
  SourceNode,
  StereoPannerNode,
} from "./context";
export type {
  CacophonyEffect,
  DynamicsOptions,
  FdnReverbOptions,
  FoaDecoderOptions,
  ReverbOptions,
  WaveshaperOptions,
} from "./effects";
export {
  BiquadEffect,
  DynamicsEffect,
  FdnReverbEffect,
  FoaDecoderEffect,
  ReverbEffect,
  ShareEffect,
  WaveshaperEffect,
} from "./effects";
export type {
  AudioEventCallbacks,
  BaseAudioEvents,
  CacheErrorEvent,
  CacheEventCallback,
  CacheHitEvent,
  CacheMissEvent,
  CacophonyEvents,
  ErrorEventCallback,
  FadeStartEvent,
  GlobalPlaybackEvent,
  LoadingCompleteEvent,
  LoadingErrorEvent,
  LoadingEventCallback,
  LoadingProgressEvent,
  LoadingStartEvent,
  PlaybackErrorEvent,
  PlaybackEvents,
  SoundErrorEvent,
  SoundEvents,
  SynthEvents,
} from "./events";
export { Group } from "./group";
export type { MediaStreamSoundOptions } from "./mediaStream";
export { MediaStreamPlayback, MediaStreamSound } from "./mediaStream";
export { MicrophonePlayback } from "./microphone";
export type { HrtfPannerOptions, PanCloneOverrides, ThreeDOptions } from "./pannerMixin";
export { Playback } from "./playback";
export type { TimeStretchOptions } from "./processors/timestretch-core";
export { timeStretch, timeStretchChannels } from "./processors/timestretch-core";
export { Sound } from "./sound";
export { encodeMonoToFoaSN3D } from "./spatial/foa-encode";
export { Synth } from "./synth";
export { SynthGroup } from "./synthGroup";
