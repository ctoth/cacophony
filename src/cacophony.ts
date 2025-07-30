import {
  AudioContext,
  AudioWorkletNode,
  IAudioListener,
  IMediaStreamAudioSourceNode,
  IPannerNode,
  IPannerOptions,
} from "standardized-audio-context";
import phaseVocoderProcessorWorkletUrl from "./bundles/phase-vocoder-bundle.js?url";
import { AudioCache, ICache } from "./cache";
import { AudioBuffer, GainNode } from "./context";
import { Group } from "./group";
import { MicrophoneStream } from "./microphone";
import type { Playback } from "./playback";
import { Sound } from "./sound";
import { createStream } from "./stream";
import { Synth } from "./synth";

export enum SoundType {
  HTML = "HTML",
  Streaming = "Streaming",
  Buffer = "Buffer",
  Oscillator = "oscillator",
}

type PannerNode = IPannerNode<AudioContext>;

type MediaStreamAudioSourceNode = IMediaStreamAudioSourceNode<AudioContext>;

/**
 * Represents a 3D position in space.
 * @typedef {Array<number>} Position - An array of three numbers representing the x, y, and z coordinates.
 */
export type Position = [x: number, y: number, z: number];

/**
 * Represents the orientation of an object in 3D space.
 * @typedef {Object} Orientation - An object containing two positions: forward and up.
 * @property {Position} forward - The forward direction of the object.
 * @property {Position} up - The up direction of the object.
 */
export type Orientation = {
  forward: Position;
  up: Position;
};

/**
 * Represents the number of times a sound should loop.
 * @typedef {number | 'infinite'} LoopCount - The number of loops, or 'infinite' for endless looping.
 */
export type LoopCount = number | "infinite";

/**
 * Represents the type of fade effect to apply.
 * @typedef {'linear' | 'exponential'} FadeType - The fade type, either 'linear' or 'exponential'.
 */
export type FadeType = "linear" | "exponential";

/**
 * Represents the type of panning effect to apply.
 * @typedef {'HRTF' | 'stereo'} PanType - The pan type, either 'HRTF' for 3D audio or 'stereo' for traditional stereo panning.
 */
export type PanType = "HRTF" | "stereo";

/**
 * The base interface for any sound-producing entity, including individual sounds, groups, and playbacks.
 * @interface BaseSound
 */
export interface BaseSound {
  isPlaying: boolean;
  play(): BaseSound[];
  seek?(time: number): void;
  stop(): void;
  pause(): void;
  addFilter(filter: BiquadFilterNode): void;
  removeFilter(filter: BiquadFilterNode): void;
  volume: number;
  position?: Position;
  threeDOptions?: any;
}

export class Cacophony {
  context: AudioContext;
  globalGainNode: GainNode;
  listener: IAudioListener;
  private prevVolume: number = 1;
  private finalizationRegistry: FinalizationRegistry<Playback>;
  private cache: ICache;

  constructor(context?: AudioContext, cache?: ICache) {
    this.context = context || new AudioContext();
    this.listener = this.context.listener;
    this.globalGainNode = this.context.createGain();
    this.globalGainNode.connect(this.context.destination);
    this.cache = cache || new AudioCache();

    this.finalizationRegistry = new FinalizationRegistry((heldValue) => {
      // Cleanup callback for Playbacks
      heldValue.cleanup();
    });
  }

  async loadWorklets() {
    if (this.context.audioWorklet) {
      await this.createWorkletNode(
        "phase-vocoder",
        phaseVocoderProcessorWorkletUrl
      );
    } else {
      console.warn("AudioWorklet not supported");
    }
  }

  async createWorkletNode(name: string, url: string) {
    // ensure audioWorklet has been loaded
    if (!this.context.audioWorklet) {
      throw new Error("AudioWorklet not supported");
    }
    try {
      return new AudioWorkletNode!(this.context, name);
    } catch (err) {
      console.error(err);
      console.log("Loading worklet from url", url);
      try {
        await this.context.audioWorklet.addModule(url);
      } catch (err) {
        console.error(err);
        throw new Error(`Could not load worklet from url ${url}`);
      }

      return new AudioWorkletNode!(this.context, name);
    }
  }

  clearMemoryCache(): void {
    this.cache.clearMemoryCache();
  }

  createOscillator(
    options: OscillatorOptions,
    panType: PanType = "HRTF"
  ): Synth {
    const synth = new Synth(
      this.context,
      this.globalGainNode,
      SoundType.Oscillator,
      panType,
      options
    );
    return synth;
  }

  async createSound(
    buffer: AudioBuffer,
    soundType?: SoundType,
    panType?: PanType,
    signal?: AbortSignal
  ): Promise<Sound>;

  async createSound(
    url: string,
    soundType?: SoundType,
    panType?: PanType,
    signal?: AbortSignal
  ): Promise<Sound>;

  async createSound(
    bufferOrUrl: AudioBuffer | string,
    soundType: SoundType = SoundType.Buffer,
    panType: PanType = "HRTF",
    signal?: AbortSignal
  ): Promise<Sound> {
    if (typeof bufferOrUrl === "object") {
      return Promise.resolve(
        new Sound(
          "",
          bufferOrUrl,
          this.context,
          this.globalGainNode,
          SoundType.Buffer,
          panType
        )
      );
    }
    const url = bufferOrUrl;
    if (soundType === SoundType.HTML) {
      const audio = new Audio();
      audio.src = url;
      audio.crossOrigin = "anonymous";
      return Promise.resolve(
        new Sound(
          url,
          undefined,
          this.context,
          this.globalGainNode,
          SoundType.HTML,
          panType
        )
      );
    }
    if (soundType === SoundType.Streaming) {
      return Promise.resolve(
        new Sound(
          url,
          undefined,
          this.context,
          this.globalGainNode,
          SoundType.Streaming,
          panType
        )
      );
    }
    return this.cache
      .getAudioBuffer(this.context, url, signal)
      .then(
        (buffer) =>
          new Sound(
            url as string,
            buffer,
            this.context,
            this.globalGainNode,
            soundType,
            panType
          )
      );
  }

  async createGroup(sounds: Sound[]): Promise<Group> {
    const group = new Group();
    sounds.forEach((sound) => group.addSound(sound));
    return group;
  }

  async createGroupFromUrls(
    urls: string[],
    soundType: SoundType = SoundType.Buffer,
    panType: PanType = "HRTF",
    signal?: AbortSignal
  ): Promise<Group> {
    const group = new Group();
    const sounds = await Promise.all(
      urls.map((url) => this.createSound(url, soundType, panType, signal))
    );
    sounds.forEach((sound) => group.addSound(sound));
    return group;
  }

  async createStream(url: string): Promise<Sound> {
    const sound = new Sound(
      url,
      undefined,
      this.context,
      this.globalGainNode,
      SoundType.Streaming
    );
    return sound;
  }

  createBiquadFilter = ({
    type,
    frequency,
    gain,
    Q,
  }: BiquadFilterOptions): BiquadFilterNode => {
    if (frequency === undefined) {
      frequency = 350;
    }
    const filter = this.context.createBiquadFilter();
    filter.type = type || "lowpass";
    filter.frequency.value = frequency;
    filter.gain.value = gain || 0;
    filter.Q.value = Q || 1;
    // @ts-expect-error
    return filter as BiquadFilterNode;
  };

  /**
   * Creates a PannerNode with the specified options.
   * @param {IPannerOptions} options - An object containing the options to use when creating the PannerNode.
   * @returns {PannerNode} A new PannerNode instance with the specified options.
   * @example
   * const panner = audio.createPanner({
   *  positionX: 0,
   * positionY: 0,
   * positionZ: 0,
   * orientationX: 0,
   * orientationY: 0,
   * orientationZ: 0,
   * });
   */

  createPanner({
    coneInnerAngle,
    coneOuterAngle,
    coneOuterGain,
    distanceModel,
    maxDistance,
    channelCount,
    channelCountMode,
    channelInterpretation,
    panningModel,
    refDistance,
    rolloffFactor,
    positionX,
    positionY,
    positionZ,
    orientationX,
    orientationY,
    orientationZ,
  }: Partial<IPannerOptions>): PannerNode {
    const panner = this.context.createPanner();
    panner.coneInnerAngle = coneInnerAngle || 360;
    panner.coneOuterAngle = coneOuterAngle || 360;
    panner.coneOuterGain = coneOuterGain || 0;
    panner.distanceModel = distanceModel || "inverse";
    panner.maxDistance = maxDistance || 10000;
    panner.channelCount = channelCount || 2;
    panner.channelCountMode = channelCountMode || "clamped-max";
    panner.channelInterpretation = channelInterpretation || "speakers";
    panner.panningModel = panningModel || "HRTF";
    panner.refDistance = refDistance || 1;
    panner.rolloffFactor = rolloffFactor || 1;
    panner.positionX.value = positionX || 0;
    panner.positionY.value = positionY || 0;
    panner.positionZ.value = positionZ || 0;
    panner.orientationX.value = orientationX || 0;
    panner.orientationY.value = orientationY || 0;
    panner.orientationZ.value = orientationZ || 0;
    return panner;
  }

  /**
   * Suspends the audio context.
   */
  pause(): void {
    if ("suspend" in this.context) {
      this.context.suspend();
    }
  }

  /**
   * Resumes the audio context.
   * This method is required to resume the audio context on mobile devices.
   * On desktop, the audio context will automatically resume when a sound is played.
   */

  resume() {
    if ("resume" in this.context) {
      this.context.resume();
    }
  }

  setGlobalVolume(volume: number) {
    this.globalGainNode.gain.value = volume;
  }

  get volume(): number {
    return this.globalGainNode.gain.value;
  }

  set volume(volume: number) {
    if (this.muted) {
      this.prevVolume = volume;
      return;
    }
    this.setGlobalVolume(volume);
  }

  mute() {
    if (!this.muted) {
      this.prevVolume = this.globalGainNode.gain.value;
      this.setGlobalVolume(0);
    }
  }

  unmute() {
    if (this.muted) {
      this.setGlobalVolume(this.prevVolume);
    }
  }

  get muted(): boolean {
    return this.globalGainNode.gain.value === 0;
  }

  set muted(muted: boolean) {
    if (muted !== this.muted) {
      if (muted) {
        this.mute();
      } else {
        this.unmute();
      }
    }
  }

  getMicrophoneStream(): Promise<MicrophoneStream> {
    return new Promise((resolve, reject) => {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          const microphoneStream = new MicrophoneStream(this.context);
          microphoneStream.play();
          resolve(microphoneStream);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  get listenerOrientation(): Orientation {
    return {
      forward: [
        this.listener.forwardX.value,
        this.listener.forwardY.value,
        this.listener.forwardZ.value,
      ],
      up: [
        this.listener.upX.value,
        this.listener.upY.value,
        this.listener.upZ.value,
      ],
    };
  }

  set listenerOrientation(orientation: Orientation) {
    const { forward, up } = orientation;
    const [forwardX, forwardY, forwardZ] = forward;
    const [upX, upY, upZ] = up;
    this.listener.forwardX.value = forwardX;
    this.listener.forwardY.value = forwardY;
    this.listener.forwardZ.value = forwardZ;
    this.listener.upX.value = upX;
    this.listener.upY.value = upY;
    this.listener.upZ.value = upZ;
  }

  get listenerUpOrientation(): Position {
    return [
      this.listener.upX.value,
      this.listener.upY.value,
      this.listener.upZ.value,
    ];
  }

  set listenerUpOrientation(up: Position) {
    const [x, y, z] = up;
    this.listener.upX.value = x;
    this.listener.upY.value = y;
    this.listener.upZ.value = z;
  }

  get listenerForwardOrientation(): Position {
    return [
      this.listener.forwardX.value,
      this.listener.forwardY.value,
      this.listener.forwardZ.value,
    ];
  }

  set listenerForwardOrientation(forward: Position) {
    const [x, y, z] = forward;
    this.listener.forwardX.value = x;
    this.listener.forwardY.value = y;
    this.listener.forwardZ.value = z;
  }

  get listenerPosition(): Position {
    return [
      this.listener.positionX.value,
      this.listener.positionY.value,
      this.listener.positionZ.value,
    ];
  }

  set listenerPosition(position: Position) {
    const [x, y, z] = position;
    const currentTime = this.context.currentTime;
    this.listener.positionX.setValueAtTime(x, currentTime);
    this.listener.positionY.setValueAtTime(y, currentTime);
    this.listener.positionZ.setValueAtTime(z, currentTime);
  }
}
