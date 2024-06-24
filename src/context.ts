import { AudioContext, IAudioBuffer, IAudioBufferSourceNode, IAudioNode, IBiquadFilterNode, IGainNode, IMediaElementAudioSourceNode, IOscillatorNode, IPannerNode, IStereoPannerNode } from 'standardized-audio-context';
export type AudioNode = IAudioNode<AudioContext>;
export type BiquadFilterNode = IBiquadFilterNode<AudioContext>;
export type MediaElementSourceNode = IMediaElementAudioSourceNode<AudioContext>;
export type AudioBuffer = IAudioBuffer;
export type AudioBufferSourceNode = IAudioBufferSourceNode<AudioContext>;
export type OscillatorNode = IOscillatorNode<AudioContext>;
export type SourceNode = AudioBufferSourceNode | MediaElementSourceNode | OscillatorNode;

export type GainNode = IGainNode<AudioContext>;
export type PannerNode = IPannerNode<AudioContext>;
export type StereoPannerNode = IStereoPannerNode<AudioContext>;
export { AudioContext };