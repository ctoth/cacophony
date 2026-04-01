/**
 * Cacophony's own audio type interfaces.
 *
 * These are minimal structural interfaces covering only what Cacophony
 * actually uses. Both the native Web Audio API and standardized-audio-context
 * satisfy these structurally, so users can pass either.
 */

// ---------------------------------------------------------------------------
// AudioParam
// ---------------------------------------------------------------------------

export interface AudioParam {
  value: number;
  setValueAtTime(value: number, startTime: number): AudioParam;
  linearRampToValueAtTime(value: number, endTime: number): AudioParam;
  exponentialRampToValueAtTime(value: number, endTime: number): AudioParam;
  cancelScheduledValues(cancelTime: number): AudioParam;
}

// ---------------------------------------------------------------------------
// AudioNode
// ---------------------------------------------------------------------------

export interface AudioNode extends EventTarget {
  connect(destination: AudioNode, output?: number, input?: number): AudioNode;
  connect(destination: AudioParam, output?: number): void;
  disconnect(): void;
  disconnect(output: number): void;
  disconnect(destination: AudioNode): void;
  disconnect(destination: AudioParam): void;
  channelCount: number;
  channelCountMode: ChannelCountMode;
  channelInterpretation: ChannelInterpretation;
  readonly context: { readonly currentTime: number };
  readonly numberOfInputs: number;
  readonly numberOfOutputs: number;
}

// ---------------------------------------------------------------------------
// Concrete node interfaces
// ---------------------------------------------------------------------------

export interface GainNode extends AudioNode {
  readonly gain: AudioParam;
}

export interface BiquadFilterNode extends AudioNode {
  type: BiquadFilterType;
  readonly frequency: AudioParam;
  readonly detune: AudioParam;
  readonly Q: AudioParam;
  readonly gain: AudioParam;
  getFrequencyResponse(frequencyHz: Float32Array, magResponse: Float32Array, phaseResponse: Float32Array): void;
}

export interface PannerNode extends AudioNode {
  coneInnerAngle: number;
  coneOuterAngle: number;
  coneOuterGain: number;
  distanceModel: DistanceModelType;
  maxDistance: number;
  panningModel: PanningModelType;
  refDistance: number;
  rolloffFactor: number;
  readonly positionX: AudioParam;
  readonly positionY: AudioParam;
  readonly positionZ: AudioParam;
  readonly orientationX: AudioParam;
  readonly orientationY: AudioParam;
  readonly orientationZ: AudioParam;
}

export interface StereoPannerNode extends AudioNode {
  readonly pan: AudioParam;
}

export interface AudioBufferSourceNode extends AudioNode {
  buffer: AudioBuffer | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParam;
  onended: ((ev: Event) => any) | null;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

export interface OscillatorNode extends AudioNode {
  type: OscillatorType;
  readonly frequency: AudioParam;
  readonly detune: AudioParam;
  onended: ((ev: Event) => any) | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface MediaElementSourceNode extends AudioNode {
  readonly mediaElement: HTMLMediaElement;
}

export interface MediaStreamAudioSourceNode extends AudioNode {
  readonly mediaStream: MediaStream;
}

// ---------------------------------------------------------------------------
// AudioBuffer
// ---------------------------------------------------------------------------

export interface AudioBuffer {
  readonly duration: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
  copyFromChannel(destination: Float32Array, channelNumber: number, bufferOffset?: number): void;
  copyToChannel(source: Float32Array, channelNumber: number, bufferOffset?: number): void;
}

// ---------------------------------------------------------------------------
// AudioListener
// ---------------------------------------------------------------------------

export interface AudioListener {
  readonly positionX: AudioParam;
  readonly positionY: AudioParam;
  readonly positionZ: AudioParam;
  readonly forwardX: AudioParam;
  readonly forwardY: AudioParam;
  readonly forwardZ: AudioParam;
  readonly upX: AudioParam;
  readonly upY: AudioParam;
  readonly upZ: AudioParam;
}

// ---------------------------------------------------------------------------
// AudioWorklet
// ---------------------------------------------------------------------------

export interface AudioWorklet {
  addModule(moduleURL: string, options?: WorkletOptions): Promise<void>;
}

// ---------------------------------------------------------------------------
// BaseContext — the common interface for all audio contexts
// ---------------------------------------------------------------------------

export interface BaseContext {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNode;
  readonly listener: AudioListener;
  readonly audioWorklet?: AudioWorklet;

  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  createBiquadFilter(): BiquadFilterNode;
  createPanner(): PannerNode;
  createStereoPanner(): StereoPannerNode;
  createOscillator(): OscillatorNode;
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBuffer>;
  decodeAudioData(
    audioData: ArrayBuffer,
    successCallback: (buffer: AudioBuffer) => void,
    errorCallback?: (error: DOMException) => void,
  ): Promise<AudioBuffer>;

  // AudioContext-only methods (not on OfflineAudioContext)
  createMediaElementSource?(mediaElement: HTMLMediaElement): MediaElementSourceNode;
  createMediaStreamSource?(stream: MediaStream): MediaStreamAudioSourceNode;
  suspend?(suspendTime?: number): Promise<void>;
  resume?(): Promise<void>;
  close?(): Promise<void>;

  // OfflineAudioContext-only methods
  startRendering?(): Promise<AudioBuffer>;
  readonly length?: number;
}

// ---------------------------------------------------------------------------
// Composite types
// ---------------------------------------------------------------------------

export type SourceNode = AudioBufferSourceNode | MediaElementSourceNode | OscillatorNode;
