import {
  AudioContext,
  type IAudioBuffer,
  type IAudioBufferSourceNode,
  type IAudioNode,
  type IBiquadFilterNode,
  type IGainNode,
  type IMediaElementAudioSourceNode,
  type IMediaStreamAudioSourceNode,
  type IOscillatorNode,
  type IPannerNode,
  type IStereoPannerNode,
} from "standardized-audio-context";
export type AudioNode = IAudioNode<AudioContext>;
export type BiquadFilterNode = IBiquadFilterNode<AudioContext>;
export type MediaElementSourceNode = IMediaElementAudioSourceNode<AudioContext>;
export type AudioBuffer = IAudioBuffer;
export type AudioBufferSourceNode = IAudioBufferSourceNode<AudioContext>;
export type OscillatorNode = IOscillatorNode<AudioContext>;
export type SourceNode = AudioBufferSourceNode | MediaElementSourceNode | OscillatorNode;
export type MediaStreamAudioSourceNode = IMediaStreamAudioSourceNode<AudioContext>;
export type GainNode = IGainNode<AudioContext>;
export type PannerNode = IPannerNode<AudioContext>;
export type StereoPannerNode = IStereoPannerNode<AudioContext>;
export { AudioContext };
