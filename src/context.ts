import { AudioContext, IAudioBufferSourceNode, IBiquadFilterNode, IGainNode, IMediaElementAudioSourceNode } from 'standardized-audio-context';
export type BiquadFilterNode = IBiquadFilterNode<AudioContext>;
export type AudioBufferSourceNode = IAudioBufferSourceNode<AudioContext>;
export type MediaElementSourceNode = IMediaElementAudioSourceNode<AudioContext>;

export type SourceNode = AudioBufferSourceNode | MediaElementSourceNode;
export type GainNode = IGainNode<AudioContext>;