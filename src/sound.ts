/**
 * The Sound class represents an audio asset within a web application, providing a high-level interface
 * for loading, manipulating, and playing audio. It supports both buffer-based and media element-based audio,
 * allowing for efficient playback and manipulation of sound resources.
 *
 * A Sound instance can manage multiple Playback instances, which represent individual playbacks of the sound.
 * This allows for the same sound to be played multiple times simultaneously or with different settings (e.g., volume,
 * playback rate, spatial positioning). The Sound class provides methods to control these playbacks collectively or individually.
 *
 * Key features include:
 * - Loading audio from a URL or using a pre-loaded buffer.
 * - Playing, pausing, resuming, and stopping audio playback.
 * - Looping audio a specific number of times or infinitely.
 * - Adjusting volume, playback rate, and spatial positioning (for 3D audio).
 * - Applying audio filters for effects like reverb, equalization, etc.
 * - Cloning the Sound instance for independent manipulation and playback.
 *
 * The relationship between Sound and Playback is central to the design of the audio system. A Sound object acts as a container
 * and manager for one or more Playback objects. Each Playback object represents a single instance of the sound being played,
 * and can be controlled individually. This architecture allows for complex audio behaviors, such as playing multiple overlapping
 * instances of a sound with different settings, without requiring the user to manually manage each playback instance.
 */

import {
  SoundType,
  type BaseSound,
  type LoopCount,
  type PanType,
} from "./cacophony";
import { PlaybackContainer } from "./container";
import type {
  AudioBuffer,
  AudioContext,
  GainNode,
  SourceNode,
} from "./context";
import { TypedEventEmitter } from "./eventEmitter";
import { SoundEvents } from "./events";
import { FilterManager } from "./filters";
import type { PanCloneOverrides } from "./pannerMixin";
import { Playback } from "./playback";
import type { VolumeCloneOverrides } from "./volumeMixin";

type SoundCloneOverrides = PanCloneOverrides &
  VolumeCloneOverrides & {
    loopCount?: LoopCount;
    playbackRate?: number;
    filters?: BiquadFilterNode[];
  };

export class Sound
  extends PlaybackContainer(FilterManager)
  implements BaseSound
{
  public declare playbacks: Playback[];
  buffer?: AudioBuffer;
  context: AudioContext;
  loopCount: LoopCount = 0;
  private _playbackRate: number = 1;
  private eventEmitter: TypedEventEmitter<SoundEvents> =
    new TypedEventEmitter<SoundEvents>();

  constructor(
    public url: string,
    buffer: AudioBuffer | undefined,
    context: AudioContext,
    private globalGainNode: GainNode,
    public soundType: SoundType = SoundType.Buffer,
    public panType: PanType = "HRTF"
  ) {
    super();
    this.buffer = buffer;
    this.context = context;

  }

  get volume(): number {
    return super.volume;
  }

  on<K extends keyof SoundEvents>(
    event: K,
    listener: (data: SoundEvents[K]) => void
  ): void {
    this.eventEmitter.on(event, listener);
  }

  off<K extends keyof SoundEvents>(
    event: K,
    listener: (data: SoundEvents[K]) => void
  ): void {
    this.eventEmitter.off(event, listener);
  }


  protected emit<K extends keyof SoundEvents>(
    event: K,
    data: SoundEvents[K]
  ): void {
    this.eventEmitter.emit(event, data);
  }

  protected async emitAsync<K extends keyof SoundEvents>(
    event: K,
    data: SoundEvents[K]
  ): Promise<PromiseSettledResult<void>[]> {
    return this.eventEmitter.emitAsync(event, data);
  }


  /**
   * Clones the current Sound instance, creating a deep copy with the option to override specific properties.
   * This method allows for the creation of a new, independent Sound instance based on the current one, with the
   * flexibility to modify certain attributes through the `overrides` parameter. This is particularly useful for
   * creating variations of a sound without affecting the original instance. The cloned instance includes all properties,
   * playback settings, and filters of the original, unless explicitly overridden.
   *
   * @param {SoundCloneOverrides} overrides - An object specifying properties to override in the cloned instance.
   *        This can include audio settings like volume, playback rate, and spatial positioning, as well as
   *        more complex configurations like 3D audio options and filter adjustments.
   * @returns {Sound} A new Sound instance that is a clone of the current sound.
   */

  clone(overrides: Partial<SoundCloneOverrides> = {}): Sound {
    const panType = overrides.panType || this.panType;
    const stereoPan =
      overrides.stereoPan !== undefined ? overrides.stereoPan : this.stereoPan;
    const threeDOptions = (overrides.threeDOptions ||
      this.threeDOptions) as PannerOptions;
    const loopCount =
      overrides.loopCount !== undefined ? overrides.loopCount : this.loopCount;
    const playbackRate = overrides.playbackRate || this.playbackRate;
    const volume =
      overrides.volume !== undefined ? overrides.volume : this.volume;
    const position =
      overrides.position !== undefined ? overrides.position : this.position;
    const filters =
      overrides.filters && overrides.filters.length
        ? overrides.filters
        : this._filters;

    const clone = new Sound(
      this.url,
      this.buffer,
      this.context,
      this.globalGainNode,
      this.soundType,
      panType
    );
    clone.loop(loopCount);
    clone.playbackRate = playbackRate;
    clone.volume = volume;
    if (panType === "HRTF") {
      clone.threeDOptions = threeDOptions;
      clone.position = position;
    } else {
      clone.stereoPan = stereoPan as number;
    }
    clone.addFilters(filters);
    return clone;
  }

  /**
   * Generates a Playback instance for the sound without starting playback.
   * This allows for pre-configuration of playback properties such as volume and position before the sound is actually played.
   * @returns {Playback[]} An array of Playback instances that are ready to be played.
   */

  preplay(): Playback[] {
    try {
      let source: SourceNode;
    if (this.buffer) {
      source = this.context.createBufferSource();
      source.buffer = this.buffer;
    } else {
      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.src = this.url;
      audio.preload = "auto";
      // we have the audio, let's make a buffer source node out of it
      source = this.context.createMediaElementSource(audio);
    }
    const gainNode = this.context.createGain();
    gainNode.connect(this.globalGainNode);
    const playback = new Playback(this, source, gainNode);
    // this.finalizationRegistry.register(playback, playback);
    playback.setGainNode(gainNode);
    playback.volume = this.volume;
    playback.playbackRate = this.playbackRate;
    this._filters.forEach((filter) => playback.addFilter(filter));
    if (this.panType === "HRTF") {
      playback.threeDOptions = this.threeDOptions;
      playback.position = this.position;
    } else if (this.panType === "stereo") {
      playback.stereoPan = this.stereoPan as number;
    }
      // Set up error propagation from playback to sound
      playback.on('error', (errorEvent) => {
        this.emitAsync('soundError', {
          url: this.url,
          error: errorEvent.error,
          errorType: 'playback',
          timestamp: errorEvent.timestamp,
          recoverable: errorEvent.recoverable,
        });
      });

      this.playbacks.push(playback);
      return [playback];
    } catch (error) {
      const errorEvent = {
        url: this.url,
        error: error as Error,
        errorType: 'playback' as const,
        timestamp: Date.now(),
        recoverable: true,
      };
      this.emitAsync('soundError', errorEvent);
      throw error;
    }
  }

  play(): ReturnType<this["preplay"]> {
    const playbacks = super.play() as ReturnType<this["preplay"]>;
    this.emit("play", playbacks[0]);
    return playbacks;
  }

  stop(): void {
    super.stop();
    this.emit("stop", undefined);
  }

  pause(): void {
    super.pause();
    this.emit("pause", undefined);
  }

  /**
   * Seeks to a specific time within the sound's playback.
   * @param { number } time - The time in seconds to seek to.
   * This method iterates through all active `Playback` instances and calls their `seek()` method with the specified time.
   */

  seek(time: number): void {
    this.playbacks.forEach((playback) => playback.seek(time));
  }

  /**
   * Retrieves the duration of the sound in seconds.
   * If the sound is based on an AudioBuffer, it returns the duration of the buffer.
   * Otherwise, if the sound has not been played and is a MediaElementSource, it returns NaN, indicating that the duration is unknown or not applicable.
   * @returns { number } The duration of the sound in seconds.
   */

  get duration() {
    if (this.playbacks.length > 0) {
      return this.playbacks[0].duration;
    }
    return this.buffer?.duration || NaN;
  }

  /**
   * Sets or retrieves the loop behavior for the sound.
   * If loopCount is provided, the sound will loop the specified number of times.
   * If loopCount is 'infinite', the sound will loop indefinitely until stopped.
   * If no argument is provided, the method returns the current loop count setting.
   * @param { LoopCount } [loopCount] - The number of times to loop or 'infinite' for indefinite looping.
   * @returns { LoopCount } The current loop count setting if no argument is provided.
   */

  loop(loopCount?: LoopCount): LoopCount {
    if (loopCount === undefined) {
      return this.loopCount;
    }
    this.loopCount = loopCount;
    this.playbacks.forEach((p) => p.loop(loopCount));
    return this.loopCount;
  }

  get playbackRate(): number {
    return this._playbackRate;
  }

  set playbackRate(rate: number) {
    this._playbackRate = rate;
    this.playbacks.forEach((p) => (p.playbackRate = rate));
    this.emit("rateChange", rate);
  }

  set volume(volume: number) {
    super.volume = volume;
    this.emit("volumeChange", volume);
  }

  cleanup(): void {
    this.playbacks.forEach((p) => p.cleanup());
    this.playbacks = [];
    this.eventEmitter.removeAllListeners();
  }
}
