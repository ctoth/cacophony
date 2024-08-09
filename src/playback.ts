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

export class Playback extends BasePlayback implements BaseSound {
  private context: AudioContext;
  public declare source?: SourceNode;
  loopCount: LoopCount = 0;
  currentLoop: number = 0;
  private buffer?: AudioBuffer;
  pauseTime: number = 0;
  startTime: number = 0;

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
      this._playing = false;
      this.stop();
    }
    if (this.loopCount === "infinite" || this.currentLoop < this.loopCount) {
      if (this.buffer) {
        this.recreateSource();
        if (this._playing) {
          (this.source as AudioBufferSourceNode).start(0);
          this._playing = true;
        }
      } else {
        if (this._playing) {
          this.seek(0);
        }
      }
    } else {
      this._playing = false;
    }
  };

  private recreateSource() {
    if (
      !this.buffer ||
      !this.source ||
      !this.panner ||
      !this.context ||
      !this.gainNode
    ) {
      throw new Error(
        "Cannot recreate source of a sound that has been cleaned up"
      );
    }
    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.panner);
    this.source.onended = this.handleLoop;
  }

  /**
   * Starts playing the audio.
   * @returns {[this]} Returns the instance of the Playback class for chaining.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  play(): [this] {
    if (!this.source) {
      throw new Error("Cannot play a sound that has been cleaned up");
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.play();
      this.startTime =
        this.context.currentTime - this.source.mediaElement.currentTime;
    } else if ("start" in this.source && this.source.start) {
      const offset = this.pauseTime ? this.pauseTime : 0;
      this.source.start(0, offset);
      this.startTime = this.context.currentTime - offset;
    }
    this._playing = true;
    return [this];
  }

  resume(): [this] {
    if (!this.source) {
      throw new Error("Cannot resume a sound that has been cleaned up");
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.play();
    } else if ("start" in this.source && this.source.start) {
      this.source.start(0, this.pauseTime);
    }
    this.startTime = this.context.currentTime - this.pauseTime;
    this._playing = true;
    return [this];
  }

  pause(): void {
    if (!this.source) {
      throw new Error("Cannot pause a sound that has been cleaned up");
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.pause();
      this.pauseTime = this.source.mediaElement.currentTime;
    } else if ("stop" in this.source && this.source.stop) {
      this.pauseTime = this.context.currentTime - this.startTime;
      this.source.stop();
    }
    this._playing = false;
  }

  /**
   * Seeks to a specific time in the audio.
   * @param {number} time - The time in seconds to seek to.
   * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
   */

  seek(time: number): void {
    if (!this.source || !this.gainNode || !this.panner) {
      throw new Error("Cannot seek a sound that has been cleaned up");
    }
    const playing = this.isPlaying;
    this.stop();
    this.pauseTime = time;
    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.currentTime = time;
      if (playing) {
        this.source.mediaElement.play();
        this.startTime = this.context.currentTime - time;
      }
    } else if (this.buffer) {
      // Create a new source to start from the desired time
      this.source = this.context.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.onended = this.handleLoop;
      this.refreshFilters();
      this.source.connect(this.panner);
      if (playing) {
        this.source.start(0, time);
        this.startTime = this.context.currentTime - time;
      }
    } else {
      throw new Error("Unsupported source type for seeking");
    }
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
    if ("mediaElement" in this.source && this.source.mediaElement) {
      const mediaElement = this.source.mediaElement;
      if (loopCount === undefined) {
        return mediaElement.loop === true ? "infinite" : 0;
      }
      mediaElement.loop = true;
      // Looping for HTMLMediaElement is controlled by the 'loop' attribute, no need for loopStart or loopEnd
      return mediaElement.loop === true ? "infinite" : 0;
    } else if ("loop" in this.source) {
      if (loopCount === undefined) {
        return this.source.loop === true ? "infinite" : 0;
      }
      this.source.loop = true;
      this.source.loopEnd = this.source.buffer?.duration || 0;
      this.source.loopStart = 0;
      return this.source.loop === true ? "infinite" : 0;
    }

    throw new Error("Unsupported source type");
  }

  /**
   * Stops the audio playback immediately.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  stop(): void {
    if (!this.source) {
      throw new Error("Cannot stop a sound that has been cleaned up");
    }
    if (!this.isPlaying) {
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
    this._playing = false;
    this.startTime = 0;
    this.pauseTime = 0;
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
