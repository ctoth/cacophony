// Public API of cacophony. Every name re-exported here is part of the package's
// supported surface. Do NOT add `export *` — every value/type must be listed
// explicitly so additions to internal modules cannot leak out without review.

export type { CreateSpriteOptions, SpriteMap, SpriteRegion } from "./audioSprite";
export { AudioSprite } from "./audioSprite";
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
  StereoToBFormatOptions,
  StreamCapabilities,
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
  ConvolverNode,
  GainNode,
  MediaElementSourceNode,
  MediaStreamAudioSourceNode,
  OscillatorNode,
  PannerNode,
  SourceNode,
  StereoPannerNode,
} from "./context";
export type {
  BarberpoleOptions,
  BuiltEffect,
  BuiltEffectGraph,
  CacophonyEffect,
  DynamicsOptions,
  FdnReverbOptions,
  FoaDecoderOptions,
  FrequencyShifterOptions,
  HarmonizerOptions,
  ImpulseResponseOptions,
  ImpulseResponseSource,
  ModulatedDelayOptions,
  PhaserOptions,
  ReverbOptions,
  SpectralFreezeOptions,
  StereoWidenerOptions,
  TremoloOptions,
  WaveshaperOptions,
} from "./effects";
export {
  BarberpoleEffect,
  BiquadEffect,
  DynamicsEffect,
  FdnReverbEffect,
  FoaDecoder,
  FoaDecoderEffect,
  FrequencyShifterEffect,
  HarmonizerEffect,
  ImpulseResponseEffect,
  ModulatedDelayEffect,
  PhaserEffect,
  ReverbEffect,
  ShareEffect,
  SpectralFreezeEffect,
  StereoWidenerEffect,
  TremoloEffect,
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
export type { CacophonyLogger } from "./logger";
export { consoleLogger, noopLogger } from "./logger";
export type { MediaStreamSoundOptions } from "./mediaStream";
export { MediaStreamPlayback, MediaStreamSound } from "./mediaStream";
export type {
  BiquadCoefficients,
  LoudnessChannel,
  LoudnessChannelInput,
} from "./meters/loudness-core";
export {
  CHANNEL_WEIGHTS,
  integratedLoudness,
  integratedUngatedLoudness,
  K_WEIGHTING_STAGE1_48K,
  K_WEIGHTING_STAGE2_48K,
  KWeightingFilter,
  loudnessRange,
} from "./meters/loudness-core";
export type { LoudnessReading } from "./meters/loudness-meter";
export { LoudnessMeter } from "./meters/loudness-meter";
export { TruePeakDetector, truePeakDb } from "./meters/truepeak-core";
export type { MicrophoneStreamOptions } from "./microphone";
export { MicrophonePlayback, MicrophoneStream } from "./microphone";
export type { HrtfPannerOptions, PanCloneOverrides, ThreeDOptions } from "./pannerMixin";
export type {
  PcmStreamBufferEvent,
  PcmStreamEvents,
  PcmStreamSoundOptions,
  PcmStreamState,
} from "./pcmStream";
export { PcmStreamPlayback, PcmStreamSound } from "./pcmStream";
export { Playback } from "./playback";
export type { TimeStretchOptions } from "./processors/timestretch-core";
export { timeStretch, timeStretchChannels } from "./processors/timestretch-core";
export type { ScheduledCallbackHandle } from "./scheduler";
export { Scheduler } from "./scheduler";
export { Sound } from "./sound";
export { encodeMonoToFoaSN3D } from "./spatial/foa-encode";
export { Synth } from "./synth";
export { SynthGroup } from "./synthGroup";
export type { WebCodecsStreamSound } from "./webCodecsStream";
