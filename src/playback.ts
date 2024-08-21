/**
 * The Playback class encapsulates the functionality for playing audio in a web application.
 * It integrates with the standardized-audio-context library to provide a cross-browser way to handle audio.
 * This class allows for the manipulation of audio playback through various features such as:
 * - Playing and stopping audio
 * - Looping audio a specific number of times or infinitely
 * - Adjusting volume and playback rate
 * - Applying stereo or 3D (HRTF) panning
 * - Adding and removing filters to modify the audio output
 * - Handling audio looping with custom logic
 * - Fading audio in and out linearly or exponentially
 * - Seeking to specific points in the audio
 * - Checking if the audio is currently playing
 * - Cleaning up resources when the audio is no longer needed
 *
 * The class is designed to be flexible and can be used with different types of audio sources,
 * including buffer sources and media elements. It also provides detailed control over the audio's
 * spatial characteristics when using 3D audio.
 */

import type { Sound } from "./sound";
import { BasePlayback } from "./basePlayback";
import type { BaseSound, LoopCount, PanType } from "./cacophony";

import type {
  AudioBuffer,
  AudioBufferSourceNode,
  AudioContext,
  GainNode,
  SourceNode,
} from "./context";

type PlaybackCloneOverrides = {
  loopCount: LoopCount;
  panType: PanType;
};
enum PlaybackState {
  Unplayed,
  Playing,
  Paused,
  Stopped,
}

export class Playback extends BasePlayback implements BaseSound {
  private context: AudioContext;
  public declare source?: SourceNode;
  loopCount: LoopCount = 0;
  currentLoop: number = 0;
  private buffer?: AudioBuffer;
  private _startTime: number = 0;
  private _offset: number = 0;
  private _state: PlaybackState = PlaybackState.Unplayed;
  private _pauseTime: number = 0;

  /**
   * Creates an instance of the Playback class.
   * @param {Sound} origin - The Sound instance that the Playback is associated with.
   * @param {SourceNode} source - The audio source node.
   * @param {GainNode} gainNode - The gain node for controlling volume.
   * @throws {Error} Throws an error if an invalid pan type is provided.
   */

  constructor(public origin: Sound, source: SourceNode, gainNode: GainNode) {
    super();
    this.context = origin.context;
    this.loopCount = origin.loopCount;
    this.setPanType(origin.panType, origin.context);
    this.source = source;
    if ("buffer" in source && source.buffer) {
      this.buffer = source.buffer;
    }
    if ("mediaElement" in source && source.mediaElement) {
      source.mediaElement.onended = this.handleLoop;
    } else if ("onended" in source) {
      source.onended = this.handleLoop;
    } else {
      throw new Error("Unsupported source type");
    }
    this.source.connect(this.panner!);
    this.setGainNode(gainNode);
    this.panner!.connect(this.gainNode!);
    this.refreshFilters();
  }

  get isPlaying(): boolean {
    return this._state === PlaybackState.Playing;
  }

  /**
   * Gets the duration of the audio in seconds.
   * @returns {number} The duration of the audio.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  get duration() {
    if (!this.buffer) {
      throw new Error(
        "Cannot get duration of a sound that has been cleaned up"
      );
    }
    return this.buffer.duration;
  }

  /**
   * Gets the current playback rate of the audio.
   * @returns {number} The current playback rate.
   * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
   */

  get playbackRate() {
    if (!this.source) {
      throw new Error(
        "Cannot get playback rate of a sound that has been cleaned up"
      );
    }
    if ("playbackRate" in this.source) {
      return this.source.playbackRate.value;
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      return this.source.mediaElement.playbackRate;
    }
    throw new Error("Unsupported source type");
  }

  /**
   * Sets the playback rate of the audio.
   * @param {number} rate - The playback rate to set.
   * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
   */

  set playbackRate(rate: number) {
    if (!this.source) {
      throw new Error(
        "Cannot set playback rate of a sound that has been cleaned up"
      );
    }
    if ("playbackRate" in this.source) {
      this.source.playbackRate.value = rate;
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.playbackRate = rate;
    }
  }

  /**
   * Handles the loop event when the audio ends.
   * This method is bound to the 'onended' event of the audio source.
   * It manages looping logic and restarts playback if necessary.
   */

  handleLoop = () => {
    if (!this.source) {
      return;
    }
    this.currentLoop++;
    if (this.loopCount !== "infinite" && this.currentLoop > this.loopCount) {
      this._state = PlaybackState.Stopped;
      this.stop();
    } else {
      if (this.buffer) {
        this.recreateSource();
        (this.source as AudioBufferSourceNode).start(0);
      } else {
        this.seek(0);
      }
      this._state = PlaybackState.Playing;
    }
  };

  /**
   * Starts playing the audio.
   * @returns {[this]} Returns the instance of the Playback class for chaining.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  play(): [this] {
    if (!this.source) {
      throw new Error("Cannot play a sound that has been cleaned up");
    }

    if (this._state === PlaybackState.Paused) {
      // Resume from paused state
      this._offset += this.context.currentTime - this._pauseTime;
    } else if (this._state !== PlaybackState.Playing) {
      this.recreateSource();
    }

    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.currentTime = this._offset;
      this.source.mediaElement.play();
    } else if ("start" in this.source && this.source.start) {
      this.source.start(0, this._offset);
    }

    this._startTime = this.context.currentTime - this._offset;
    this._state = PlaybackState.Playing;
    return [this];
  }

  pause(): void {
    if (!this.source || this._state !== PlaybackState.Playing) {
      return;
    }

    this._state = PlaybackState.Paused;
    this._pauseTime = this.context.currentTime;

    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.pause();
    } else if ("stop" in this.source) {
      this.source.stop();
    }
  }

  seek(time: number): void {
    if (!this.source || !this.gainNode || !this.panner) {
      throw new Error("Cannot seek a sound that has been cleaned up");
    }

    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.stop();
    }

    this._offset = time;

    if (wasPlaying) {
      this.play();
    }
  }

  get currentTime(): number {
    switch (this._state) {
      case PlaybackState.Unplayed:
      case PlaybackState.Stopped:
        return this._offset;
      case PlaybackState.Paused:
        return this._pauseTime - this._startTime + this._offset;
      case PlaybackState.Playing:
        return this.context.currentTime - this._startTime + this._offset;
    }
  }

  private recreateSource() {
    if (!this.buffer || !this.panner || !this.context || !this.gainNode) {
      throw new Error(
        "Cannot recreate source of a sound that has been cleaned up"
      );
    }
    if (this.source) {
      this.source.disconnect();
    }
    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.panner);
    this.source.onended = this.handleLoop;
    this.refreshFilters();
  }

  /**
   * Sets whether the audio source should loop.
   * @param {boolean} loop - Whether the audio should loop.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */
  set sourceLoop(loop: boolean) {
    if (!this.source) {
      throw new Error("Cannot set loop on a sound that has been cleaned up");
    }
    if ("loop" in this.source) {
      this.source.loop = loop;
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.loop = loop;
    }
  }

  /**
   * Cleans up resources used by the Playback instance.
   * This method should be called when the audio is no longer needed to free up resources.
   */

  cleanup(): void {
    // Ensure cleanup is idempotent
    if (this.source) {
      this.source.disconnect();
      this.source = undefined;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = undefined;
    }
    this._filters.forEach((filter) => {
      if (filter) {
        filter.disconnect();
      }
    });
    this._filters = [];
  }

  /**
   * Sets or gets the loop count for the audio.
   * @param {LoopCount} loopCount - The number of times the audio should loop. 'infinite' for endless looping.
   * @returns {LoopCount} The loop count if no parameter is provided.
   * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
   */

  loop(loopCount?: LoopCount): LoopCount {
    if (!this.source) {
      throw new Error("Cannot loop a sound that has been cleaned up");
    }
    if (loopCount !== undefined) {
      this.loopCount = loopCount;
      this.currentLoop = 0;
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      const mediaElement = this.source.mediaElement;
      mediaElement.loop = this.loopCount === "infinite";
    } else if ("loop" in this.source) {
      this.source.loop = this.loopCount === "infinite";
      if (this.source.buffer) {
        this.source.loopEnd = this.source.buffer.duration;
        this.source.loopStart = 0;
      }
    } else {
      throw new Error("Unsupported source type");
    }
    return this.loopCount;
  }

  /**
   * Stops the audio playback immediately.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  stop(): void {
    if (!this.source) {
      throw new Error("Cannot stop a sound that has been cleaned up");
    }
    if (
      this._state === PlaybackState.Stopped ||
      this._state === PlaybackState.Unplayed
    ) {
      return;
    }
    try {
      if ("stop" in this.source) {
        this.source.stop();
      }
      if ("mediaElement" in this.source && this.source.mediaElement) {
        this.source.mediaElement.pause();
        this.source.mediaElement.currentTime = 0;
      }
    } catch (e) {}
    this._state = PlaybackState.Stopped;
    this._offset = 0;
    this._pauseTime = 0;
  }

  /**
   * Adds a filter to the audio signal chain.
   * @param {BiquadFilterNode} filter - The filter to add.
   */

  addFilter(filter: BiquadFilterNode): void {
    // we have to clone the filter to avoid reusing the same filter node
    const newFilter = filter.context.createBiquadFilter();
    newFilter.type = filter.type;
    newFilter.frequency.value = filter.frequency.value;
    newFilter.Q.value = filter.Q.value;
    super.addFilter(newFilter);
    this.refreshFilters();
  }

  /**
   * Removes a filter from the audio signal chain.
   * @param {BiquadFilterNode} filter - The filter to remove.
   */

  removeFilter(filter: BiquadFilterNode): void {
    super.removeFilter(filter);
    this.refreshFilters();
  }

  /**
   * Refreshes the audio filters by re-applying them to the audio signal chain.
   * This method is called internally whenever filters are added or removed.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  private refreshFilters(): void {
    if (!this.panner || !this.gainNode) {
      throw new Error(
        "Cannot update filters on a sound that has been cleaned up"
      );
    }
    let connection = this.panner;
    connection.disconnect();
    connection = this.applyFilters(connection);
    connection.connect(this.gainNode);
  }

  /**
   * Creates a clone of the current Playback instance with optional overrides for certain properties.
   * This method allows for the creation of a new Playback instance that shares the same audio context
   * and source node but can have different settings such as loop count or pan type.
   * @param {Partial<Playback>} overrides - An object containing properties to override in the cloned instance.
   * @returns {Playback} A new Playback instance cloned from the current one with the specified overrides applied.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  clone(overrides: Partial<PlaybackCloneOverrides> = {}): Playback {
    if (!this.source || !this.gainNode || !this.context) {
      throw new Error("Cannot clone a sound that has been cleaned up");
    }
    const panType = overrides.panType || this.panType;
    // we'll need to create a new gain node
    const gainNode = this.context.createGain();
    // clone the source node
    let source: SourceNode;
    if ("buffer" in this.source && this.source.buffer) {
      source = this.context.createBufferSource();
      source.buffer = this.source.buffer;
    } else if ("mediaElement" in this.source && this.source.mediaElement) {
      source = this.context.createMediaElementSource(this.source.mediaElement);
    } else {
      throw new Error("Unsupported source type");
    }
    const loopCount =
      overrides.loopCount !== undefined ? overrides.loopCount : this.loopCount;
    const clone = new Playback(this.origin, source, gainNode);
    clone.loopCount = loopCount;
    clone.setPanType(panType, this.context);
    clone.volume = this.volume;
    return clone;
  }
}
