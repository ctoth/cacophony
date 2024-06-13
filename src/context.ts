import { AudioContext, IAudioBuffer, IAudioBufferSourceNode, IBiquadFilterNode, IGainNode, IMediaElementAudioSourceNode, IPannerNode, IStereoPannerNode, IOscillatorNode } from 'standardized-audio-context';
export {
    AudioBuffer, AudioContext, IAudioBuffer, IPannerOptions,
} from 'standardized-audio-context';
export type BiquadFilterNode = IBiquadFilterNode<AudioContext>;
export type MediaElementSourceNode = IMediaElementAudioSourceNode<AudioContext>;
export type AudioBufferSourceNode = IAudioBufferSourceNode<AudioContext>;
export type OscillatorNode = IOscillatorNode<AudioContext>;
export type SourceNode = AudioBufferSourceNode | MediaElementSourceNode | OscillatorNode;


export type GainNode = IGainNode<AudioContext>;
export type PannerNode = IPannerNode<AudioContext>;
export type StereoPannerNode = IStereoPannerNode<AudioContext>;
