/**
 * The Playback class encapsulates the functionality for playing audio in a web application.
 * It integrates with the repo's audio-context abstractions so playback works across native and mocked contexts.
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

import { BasePlayback } from "./basePlayback";
import type { Bus } from "./bus";
import type { BaseSound, FadeType, LoopCount, PanType } from "./cacophony";
import type {
  AudioBuffer,
  AudioNode,
  AudioParam,
  AudioWorkletNode,
  BaseContext,
  BiquadFilterNode,
  GainNode,
  SourceNode,
} from "./context";
import type { Sound } from "./sound";
import { WORKLETS } from "./worklets";

type PlaybackCloneOverrides = {
  loopCount: LoopCount;
  panType: PanType;
};

export class Playback extends BasePlayback implements BaseSound {
  private context: BaseContext;
  public declare source?: SourceNode;
  loopCount: LoopCount = 0;
  currentLoop: number = 0;
  private buffer?: AudioBuffer;
  private _offset: number = 0;
  private _startTime: number = 0;
  private _playbackRate: number = 1;
  /**
   * Promise that tracks an in-flight media-element `.play()` settlement.
   * Set when the media element's `play()` returns a pending promise; cleared
   * once that promise settles. Used by `loopEnded` to avoid racing source-state
   * mutations (`seek`/`play`) against the deferred state transition driven by
   * this promise.
   */
  private _mediaPlayPromise?: Promise<void>;
  _fadeInConfig?: { duration: number; type: FadeType; perLoop: boolean; targetVolume: number };
  _fadeOutConfig?: { duration: number; type: FadeType };
  _loopEndCallback?: () => void;
  /**
   * Per-playback send-gain allocations: bus → allocated GainNode. Sounds
   * record send intent in `Sound._sends` (value-only), and the actual
   * GainNode lifecycle is owned here — allocated at preplay or
   * `Sound.routeTo(bus, gain)`, torn down in {@link cleanup}.
   *
   * Iterable Map (not WeakMap) so cleanup can walk every send and call
   * `disconnect()` on it; relying on GC for disconnect would leave the bus
   * graph holding the allocation indirectly.
   */
  _sendGains: Map<Bus, GainNode> = new Map();

  /**
   * Desired pitch-shift factor (1 = no shift, 2 = +1 octave, 0.5 = -1 octave).
   * Stored even before the worklet node exists so a value set on a cleaned-up /
   * not-yet-built playback is honoured once {@link setPitchShift} builds the node.
   */
  private _pitchFactor: number = 1;
  /**
   * The phase-vocoder AudioWorkletNode (Laroche & Dolson 1999 peak-based
   * pitch-shift with Identity Phase-Locking) spliced into this playback's chain
   * between the filter tail and {@link gainNode}. `undefined` until
   * {@link setPitchShift} is first called with a factor != 1; lazily built via
   * `cacophony.createPhaseVocoderNode`. {@link refreshFilters} re-inserts it on
   * every chain rebuild so it is never bypassed.
   */
  private _pitchShiftNode?: AudioWorkletNode;

  /**
   * Creates an instance of the Playback class.
   * @throws {Error} Throws an error if an invalid pan type is provided.
   */

  constructor(
    public origin: Sound,
    source: SourceNode,
    gainNode: GainNode,
  ) {
    super(origin);
    this.context = origin.context;
    this.loopCount = origin.loopCount;
    this.setPanType(origin.panType, origin.context);
    this.source = source;
    if ("buffer" in source && source.buffer) {
      this.buffer = source.buffer;
    }
    this.setupSourceNode(source);
    this.source.connect(this.panner!);
    this.setGainNode(gainNode);
    this.panner!.connect(this.gainNode!);
    this.refreshFilters();
  }

  override setPanType(panType: PanType, audioContext: BaseContext): void {
    const previousPanner = this.panner;
    super.setPanType(panType, audioContext);

    if (this.panner === previousPanner || !this.panner || !this.source || !this.gainNode) {
      return;
    }

    this.source.disconnect();
    this.source.connect(this.panner);
    this.refreshFilters();
  }

  private setupSourceNode(source: SourceNode) {
    if ("mediaElement" in source && source.mediaElement) {
      source.mediaElement.onended = this.loopEnded;
    } else if ("onended" in source) {
      source.onended = this.loopEnded;
    } else {
      throw new Error("Unsupported source type");
    }
  }

  /**
   * Gets the duration of the audio in seconds.
   * @returns {number} The duration of the audio or NaN if the duration is unknown.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  get duration() {
    if (!this.source) {
      throw new Error("Cannot get duration of a sound that has been cleaned up");
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      return this.source.mediaElement.duration;
    }
    if (!this.buffer) {
      return NaN;
    }
    return this.buffer.duration || NaN;
  }

  /**
   * Gets the current playback rate of the audio.
   */

  get playbackRate() {
    return this._playbackRate;
  }

  get volume(): number {
    return super.volume;
  }

  set volume(volume: number) {
    super.volume = volume;
    this.emit("volumeChange", volume);
  }

  /**
   * Sets the playback rate of the audio.
   * @throws {Error} Throws an error if the sound has been cleaned up or if the source type is unsupported.
   */

  set playbackRate(rate: number) {
    if (rate <= 0) {
      throw new Error("Playback rate must be greater than 0");
    }
    if (this._state === "playing") {
      const elapsed = (this.context.currentTime - this._startTime) * this._playbackRate;
      this._offset += elapsed;
      this._startTime = this.context.currentTime;
    }
    this._playbackRate = rate;
    if (!this.source) {
      return;
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
  loopEnded = (): void => {
    if (!this.source || this._state !== "playing") {
      return;
    }

    // For media-element sources, a previous play() may still have a pending
    // settlement promise -- the deferred state transition races with the
    // seek+play we are about to perform. Defer the loop work until the
    // pending play resolves so source mutations don't interleave.
    if ("mediaElement" in this.source && this._mediaPlayPromise) {
      void this._mediaPlayPromise.then(() => this._runLoopEnded());
      return;
    }

    this._runLoopEnded();
  };

  private _runLoopEnded(): void {
    if (!this.source || this._state !== "playing") {
      return;
    }

    this.currentLoop++;

    if (this.loopCount !== "infinite" && this.currentLoop > this.loopCount) {
      // Final iteration -- emit ended, then either fade out or stop immediately
      this.emit("ended", undefined);
      if (this._fadeOutConfig) {
        // Guard the chained stop: an external stop()/cleanup() between the
        // fade resolving and this .then would otherwise run stop()/source
        // access against torn-down state. cancelFade() in stop()/cleanup()
        // resolves the fade promise synchronously, which is what makes this
        // .then fire at all after a teardown.
        void this.fadeOut(this._fadeOutConfig.duration, this._fadeOutConfig.type).then(() => {
          if (this._state !== "stopped" && this.source) {
            this.stop();
            this.removeFromOrigin();
          }
        });
      } else {
        this.stop();
        this.removeFromOrigin();
      }
    } else {
      this._loopEndCallback?.();
      this.seek(0); // Resets offset and handles play/pause state internally.
      // seek() calls pause() then play() when wasPlaying is true,
      // so play() handles both media-element and buffer sources correctly.
      if (this._state !== "playing" && this.source && !("mediaElement" in this.source)) {
        // For AudioBufferSourceNode only: if seek() didn't restart playback
        // (e.g., state wasn't Playing before seek), start it now.
        this.play();
      }

      // Re-trigger fade-in if perLoop config is set
      if (this._fadeInConfig?.perLoop && this.gainNode) {
        this.gainNode.gain.setValueAtTime(0.0001, this.gainNode.context.currentTime);
        this.fadeTo(this._fadeInConfig.targetVolume, this._fadeInConfig.duration, this._fadeInConfig.type);
      }
    }
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

    if (this._state === "playing") {
      return [this];
    }

    const isResume = this._state === "paused";

    try {
      let mediaPlayPromise: Promise<void> | undefined;

      if (this._state === "paused") {
        // If we're resuming from a paused state
        if ("mediaElement" in this.source && this.source.mediaElement) {
          mediaPlayPromise = this.source.mediaElement.play();
        } else {
          // For non-mediaElement sources, we need to recreate and start the source
          this.recreateSource();
          if ("start" in this.source && this.source.start) {
            this.source.start(0, this._offset);
          }
        }
      } else {
        // If we're starting from the beginning or a stopped state

        if ("mediaElement" in this.source && this.source.mediaElement) {
          this.source.mediaElement.currentTime = this._offset;
          mediaPlayPromise = this.source.mediaElement.play();
        } else if ("start" in this.source && this.source.start) {
          this.recreateSource();
          this.source.start(0, this._offset);
        }
      }

      if (mediaPlayPromise) {
        // For media-element sources, defer state and events until browser accepts playback
        // Stash the pending promise so loopEnded (and any future caller that
        // needs to sequence after the deferred state transition) can await it
        // rather than racing source-state mutations against it.
        const tracked = mediaPlayPromise
          .then(
            () => {
              this._startTime = this.context.currentTime;
              this.markPlaying();
              this.emit("play", this);
              if (isResume) {
                this.emit("resume", undefined);
              }
              this.origin.cacophony?.emit("globalPlay", {
                source: this.origin,
                timestamp: Date.now(),
              });
            },
            (error: Error) => {
              void this.emitAsync("error", {
                error,
                errorType: "source",
                timestamp: Date.now(),
                recoverable: true,
              });
            },
          )
          .finally(() => {
            if (this._mediaPlayPromise === tracked) {
              this._mediaPlayPromise = undefined;
            }
          });
        this._mediaPlayPromise = tracked;
      } else {
        // For buffer sources, state transition is immediate (start() is synchronous)
        this._startTime = this.context.currentTime;
        this.markPlaying();
        this.emit("play", this);
        if (isResume) {
          this.emit("resume", undefined);
        }
        this.origin.cacophony?.emit("globalPlay", {
          source: this.origin,
          timestamp: Date.now(),
        });
      }

      return [this];
    } catch (error) {
      this.emitAsync("error", {
        error: error as Error,
        errorType: "source",
        timestamp: Date.now(),
        recoverable: true,
      });
      throw error;
    }
  }

  pause(): void {
    if (!this.source || this._state !== "playing") {
      return;
    }

    const elapsed = (this.context.currentTime - this._startTime) * this._playbackRate;
    this._offset += elapsed;

    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.pause();
    } else if ("stop" in this.source) {
      // For AudioBufferSourceNode and OscillatorNode, stop the source.
      // It cannot be restarted; a new one will be created on play().
      this.source.stop();
    }

    this.markPaused();
    this.emit("pause", undefined);

    // Emit globalPause for all playback
    this.origin.cacophony?.emit("globalPause", {
      source: this.origin,
      timestamp: Date.now(),
    });
  }

  stop(): void {
    if (!this.source) {
      throw new Error("Cannot stop a sound that has been cleaned up");
    }
    if (this._state === "stopped" || this._state === "unplayed") {
      return;
    }

    this.cancelFade();

    if ("stop" in this.source && this._state === "playing") {
      this.source.stop();
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.pause();
      this.source.mediaElement.currentTime = 0;
    }

    this._offset = 0;
    this._startTime = 0;
    this.markStopped();
    this.emit("stop", undefined);

    // Emit globalStop for all playback
    this.origin.cacophony?.emit("globalStop", {
      source: this.origin,
      timestamp: Date.now(),
    });
  }

  /**
   * Fades in from silence to the current volume.
   * Optionally stores config to re-trigger the fade on each loop iteration.
   * @param {number} duration - The fade duration in milliseconds.
   * @param {FadeType} type - The fade curve type. Defaults to "linear".
   * @param {object} options - Optional. Set perLoop: true to re-trigger fadeIn on each loop.
   * @returns {Promise<void>} Resolves when the fade completes.
   */
  fadeIn(duration: number, type?: FadeType, options?: { perLoop?: boolean }): Promise<void> {
    if (options?.perLoop) {
      this._fadeInConfig = {
        duration,
        type: type ?? "linear",
        perLoop: true,
        targetVolume: this.gainNode!.gain.value,
      };
    }
    return super.fadeIn(duration, type);
  }

  /**
   * Configures a fade-out to be applied when the playback ends naturally (last loop iteration).
   * @param {number} duration - The fade-out duration in milliseconds.
   * @param {FadeType} type - The fade curve type. Defaults to "linear".
   */
  configureFadeOut(duration: number, type?: FadeType): void {
    this._fadeOutConfig = { duration, type: type ?? "linear" };
  }

  /**
   * Fades out then stops the playback.
   * @param {number} duration - The fade-out duration in milliseconds.
   * @param {FadeType} type - The fade curve type. Defaults to "linear".
   * @returns {Promise<void>} Resolves when the fade completes and playback is stopped.
   */
  stopWithFade(duration: number, type?: FadeType): Promise<void> {
    // Guard the chained stop: if an external stop()/cleanup() runs between
    // the fade resolving and this .then, the chained stop() would otherwise
    // throw against torn-down state ("Cannot stop a sound that has been
    // cleaned up"). cancelFade() inside stop()/cleanup() resolves the fade
    // promise synchronously, so this .then will still fire -- the guard
    // makes it a no-op when the playback is already stopped or cleaned up.
    return this.fadeOut(duration, type).then(() => {
      if (this._state !== "stopped" && this.source) {
        this.stop();
      }
    });
  }

  seek(time: number): void {
    if (!this.source || !this.gainNode || !this.panner) {
      throw new Error("Cannot seek a sound that has been cleaned up");
    }
    if (!Number.isFinite(time) || time < 0) {
      throw new Error("Invalid time value for seek");
    }

    const wasPlaying = this._state === "playing";
    if (wasPlaying) {
      this.pause();
    }

    this._offset = time;

    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.currentTime = time;
    }
    // For non-media elements, play() will handle recreating the source if needed.

    if (wasPlaying) {
      this.play();
    }
  }

  get currentTime(): number {
    if (this._state === "playing") {
      const elapsed = (this.context.currentTime - this._startTime) * this._playbackRate;
      return this._offset + elapsed;
    } else {
      return this._offset;
    }
  }

  private removeFromOrigin(): void {
    const idx = this.origin.playbacks.indexOf(this);
    if (idx !== -1) {
      this.origin.playbacks.splice(idx, 1);
    }
  }

  private recreateSource() {
    if (!this.buffer || !this.panner || !this.context || !this.gainNode) {
      throw new Error("Cannot recreate source of a sound that has been cleaned up");
    }
    try {
      if (this.source) {
        // It's crucial to nullify onended of the old source if it's an AudioBufferSourceNode (or similar non-restartable source),
        // as its onended event could otherwise interfere with the new source created for seek/resume.
        // MediaElementAudioSourceNode is handled differently as its underlying element can be paused/played.
        if (!("mediaElement" in this.source) && "onended" in this.source) {
          this.source.onended = null;
        }
        this.source.disconnect();
      }
      this.source = this.context.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.connect(this.panner);
      this.source.onended = this.loopEnded;
      this.playbackRate = this._playbackRate;
      this.refreshFilters();
    } catch (error) {
      this.emitAsync("error", {
        error: error as Error,
        errorType: "source",
        timestamp: Date.now(),
        recoverable: false,
      });
      throw error;
    }
  }

  /**
   * Sets whether the audio source should loop.
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
    if (!this.source) {
      return; // Already cleaned up
    }
    if ("mediaElement" in this.source && this.source.mediaElement) {
      this.source.mediaElement.pause();
      this.source.mediaElement.currentTime = 0;
      this.source.mediaElement.loop = false;
      this.source.mediaElement.onended = null;
    } else if ("onended" in this.source) {
      this.source.onended = null;
    }
    this._offset = 0;
    this._startTime = 0;
    this.markStopped();
    this.currentLoop = 0;
    this.source.disconnect();
    this.source = undefined;
    // Tear down any per-playback send-gain nodes allocated by Sound.routeTo
    // (or preplay) before the gainNode is severed by super.cleanup(). The
    // gainNode → sendGain → bus.input chain is now fully disconnected.
    for (const sendGain of this._sendGains.values()) {
      try {
        sendGain.disconnect();
      } catch {
        // Best-effort — node may already have been disconnected externally.
      }
    }
    this._sendGains.clear();
    // Tear down the phase-vocoder pitch-shift worklet node if one was spliced in.
    if (this._pitchShiftNode) {
      try {
        this._pitchShiftNode.disconnect();
      } catch {
        // Best-effort — node may already have been disconnected externally.
      }
      this._pitchShiftNode = undefined;
    }
    super.cleanup();
  }

  private assertNotCleanedUp(): void {
    if (!this.source || !this.gainNode || !this.panner) {
      throw new Error("Cannot perform operation on a sound that has been cleaned up");
    }
  }

  addFilter(filter: BiquadFilterNode): void {
    this.assertNotCleanedUp();
    super.addFilter(filter);
    this.refreshFilters();
  }

  removeFilter(filter: BiquadFilterNode): void {
    this.assertNotCleanedUp();
    super.removeFilter(filter);
    this.refreshFilters();
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
      this.loopCount = loopCount === "infinite" ? "infinite" : Math.max(0, loopCount);
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
   * Refreshes the audio filters by re-applying them to the audio signal chain.
   * This method is called internally whenever filters are added or removed.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  private refreshFilters(): void {
    if (!this.panner || !this.gainNode) {
      throw new Error("Cannot update filters on a sound that has been cleaned up");
    }
    let connection: AudioNode = this.panner;
    connection.disconnect();
    connection = this.applyFilters(connection);
    // Splice the phase-vocoder pitch-shift worklet (if active) AFTER the filter
    // chain and BEFORE the gainNode, so the rebuilt chain is
    // panner → [filters] → pitchShiftNode → gainNode. Re-inserted on every
    // rebuild so it is never bypassed when filters change. (Laroche & Dolson
    // 1999 peak-based pitch shift — see Playback.setPitchShift.)
    if (this._pitchShiftNode) {
      this._pitchShiftNode.disconnect();
      connection.connect(this._pitchShiftNode);
      connection = this._pitchShiftNode;
    }
    connection.connect(this.gainNode);
  }

  /**
   * Sets the pitch-shift factor for this playback, resurrecting the dormant
   * phase-vocoder worklet (Jean Laroche & Mark Dolson, "New Phase-Vocoder
   * Techniques for Pitch-Shifting, Harmonizing and Other Exotic Effects",
   * 1999 IEEE WASPAA — peak-based pitch shift with Identity Phase-Locking).
   *
   * On first use (factor !== 1) the phase-vocoder AudioWorkletNode is built via
   * `cacophony.createPhaseVocoderNode` and spliced into this playback's graph at
   * the {@link refreshFilters} seam (panner → [filters] → pitchShiftNode →
   * gainNode). The factor is forwarded to the node's `pitchFactor` AudioParam
   * (1 = no shift, 2 = +1 octave, 0.5 = -1 octave).
   *
   * @param factor Pitch multiplier (> 0).
   * @throws {Error} if the playback has been cleaned up or factor <= 0.
   */
  async setPitchShift(factor: number): Promise<void> {
    this.assertNotCleanedUp();
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error("Pitch-shift factor must be greater than 0");
    }
    this._pitchFactor = factor;

    // factor === 1 is the documented "no shift" contract and MUST be a genuine
    // passthrough. The peak/region phase-vocoder pipeline does NOT guarantee
    // identity for peakless / edge-bin / broadband content (it zero-fills and
    // only repopulates detected peak regions), so we cannot leave the node in
    // the chain at factor 1. Tear it down and rebuild the chain so the signal
    // bypasses the worklet entirely (panner → [filters] → gainNode). A later
    // non-unity factor rebuilds a fresh node.
    if (factor === 1) {
      if (this._pitchShiftNode) {
        try {
          this._pitchShiftNode.disconnect();
        } catch {
          // Best-effort — node may already have been disconnected.
        }
        this._pitchShiftNode = undefined;
        this.refreshFilters();
      }
      return;
    }

    if (!this._pitchShiftNode) {
      const cacophony = this.origin.cacophony;
      if (!cacophony) {
        throw new Error("Cannot pitch-shift a playback whose Sound has no Cacophony instance");
      }
      this._pitchShiftNode = await cacophony.buildWorkletEffect(WORKLETS.phaseVocoder, {}, this.context);
      // Insert the freshly built node into the live chain.
      this.refreshFilters();
    }

    const pitchParam = this._pitchShiftNode.parameters?.get("pitchFactor");
    if (pitchParam) {
      pitchParam.value = factor;
    }
  }

  /**
   * The current pitch-shift factor (1 = no shift). See {@link setPitchShift}.
   */
  get pitchShift(): number {
    return this._pitchFactor;
  }

  /**
   * Gets the output node of this playback's audio graph.
   * This is the final node in the internal chain before connection to destination.
   * Use this to manually wire the playback into custom audio graphs.
   *
   * @returns {GainNode} The gain node that serves as the output of this playback.
   * @throws {Error} Throws an error if the playback has been cleaned up.
   *
   * @example
   * // Manual routing through custom effects
   * const playback = sound.play()[0];
   * playback.disconnect(); // Disconnect from default destination
   * playback.connect(reverbNode).connect(context.destination);
   */
  get outputNode(): GainNode {
    if (!this.gainNode) {
      throw new Error("Cannot access output node of a playback that has been cleaned up");
    }
    return this.gainNode;
  }

  /**
   * Connects this playback's output to an AudioNode or AudioParam.
   * Follows the Web Audio API connection pattern.
   *
   * @returns {AudioNode} The destination node (for chaining).
   * @throws {Error} Throws an error if the playback has been cleaned up.
   *
   * @example
   * // Chain multiple effects
   * playback.connect(delay).connect(reverb).connect(context.destination);
   */
  connect(destination: AudioNode | AudioParam): AudioNode {
    return this.outputNode.connect(destination as any);
  }

  /**
   * Disconnects this playback's output from a specific destination or from all destinations.
   *
   * @param {AudioNode | AudioParam} [destination] - Optional specific destination to disconnect from.
   *                                                   If omitted, disconnects from all destinations.
   * @throws {Error} Throws an error if the playback has been cleaned up.
   *
   * @example
   * // Disconnect from all
   * playback.disconnect();
   *
   * @example
   * // Disconnect from specific node
   * playback.disconnect(reverbNode);
   */
  disconnect(destination?: AudioNode | AudioParam): void {
    if (destination) {
      this.outputNode.disconnect(destination as any);
    } else {
      this.outputNode.disconnect();
    }
  }

  /**
   * Creates a clone of the current Playback instance with optional overrides for certain properties.
   * This method allows for the creation of a new Playback instance that shares the same audio context
   * and source node but can have different settings such as loop count or pan type.
   * The clone is connected to the origin Sound's primary route and registered with the Sound.
   * @throws {Error} Throws an error if the sound has been cleaned up.
   */

  clone(overrides: Partial<PlaybackCloneOverrides> = {}): Playback {
    if (!this.source || !this.gainNode || !this.context) {
      throw new Error("Cannot clone a sound that has been cleaned up");
    }
    const panType = overrides.panType ?? this.panType;
    // we'll need to create a new gain node
    const gainNode = this.context.createGain();
    gainNode.connect(this.origin._resolveRouteTargetNode());
    // clone the source node
    let source: SourceNode;
    if ("buffer" in this.source && this.source.buffer) {
      source = this.context.createBufferSource();
      source.buffer = this.source.buffer;
    } else if ("mediaElement" in this.source && this.source.mediaElement) {
      if (!this.context.createMediaElementSource) {
        throw new Error("Media element sources are not supported on this audio context.");
      }
      // The Web Audio spec forbids creating a second MediaElementAudioSourceNode
      // from the same HTMLMediaElement -- the second call throws
      // InvalidStateError. Clone the underlying element first so the new
      // playback owns an independent element that hasn't been bound yet.
      const originalElement = this.source.mediaElement;
      const clonedElement = originalElement.cloneNode(true) as HTMLMediaElement;
      source = this.context.createMediaElementSource(clonedElement);
    } else {
      throw new Error("Unsupported source type");
    }
    const loopCount = overrides.loopCount !== undefined ? overrides.loopCount : this.loopCount;
    const clone = new Playback(this.origin, source, gainNode);

    // Copy all relevant properties
    clone.loopCount = loopCount;
    clone.currentLoop = this.currentLoop;
    clone.setPanType(panType, this.context);
    clone.volume = this.volume;
    clone.playbackRate = this._playbackRate;
    clone._offset = this._offset;
    if (this._state === "paused") {
      clone.markPaused();
    } else if (this._state === "stopped") {
      clone.markStopped();
    }

    // Deep clone filters
    this._filters.forEach((filter) => {
      const clonedFilter = this.context.createBiquadFilter();
      clonedFilter.type = filter.type;
      clonedFilter.frequency.value = filter.frequency.value;
      clonedFilter.Q.value = filter.Q.value;
      clonedFilter.gain.value = filter.gain.value;
      clone.addFilter(clonedFilter as unknown as BiquadFilterNode);
    });

    // If the original is playing, start the clone
    if (this._state === "playing") {
      clone.play();
    }

    this.origin.playbacks.push(clone);
    return clone;
  }
}
