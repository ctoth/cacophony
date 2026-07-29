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

import type { Bus, BusRoutedSource } from "./bus";
import type {
  BaseSound,
  Cacophony,
  LoopCount,
  PanType,
  PlayOptions,
  SoundCleanupHoldings,
  SoundType,
} from "./cacophony";
import { PlaybackContainer } from "./container";
import type { AudioBuffer, BaseContext, BiquadFilterNode, GainNode, SourceNode } from "./context";
import { TypedEventEmitter } from "./eventEmitter";
import type { SoundEvents } from "./events";
import { FilterManager } from "./filters";
import type { PanCloneOverrides } from "./pannerMixin";
import { Playback } from "./playback";
import type { TimeStretchOptions } from "./processors/timestretch-core";
import type { VolumeCloneOverrides } from "./volumeMixin";

type SoundCloneOverrides = PanCloneOverrides &
  VolumeCloneOverrides & {
    loopCount?: LoopCount;
    playbackRate?: number;
    filters?: BiquadFilterNode[];
  };

export class Sound extends PlaybackContainer(FilterManager) implements BaseSound, BusRoutedSource {
  public declare playbacks: Playback[];
  buffer?: AudioBuffer;
  context: BaseContext;
  loopCount: LoopCount = 0;
  private _playbackRate: number = 1;
  /**
   * Pitch-shift factor applied to every playback of this Sound (1 = no shift).
   * Fanned out across live playbacks by {@link setPitchShift} and applied to
   * future playbacks at {@link preplay}. Drives the phase-vocoder worklet
   * (Laroche & Dolson 1999 peak-based pitch shift).
   */
  private _pitchFactor: number = 1;
  private eventEmitter: TypedEventEmitter<SoundEvents> = new TypedEventEmitter<SoundEvents>();
  private _holdings: SoundCleanupHoldings = { sources: [], gainNodes: [], mediaElements: [] };
  private _unregisterToken: object = {};
  /**
   * Per-playback unsubscribe functions for the listeners that Sound attaches
   * to each playback in {@link preplay}. Tracked so the Sound→playback
   * closure cycle (each listener captures `this`) can be broken explicitly
   * when the playback ends, stops, or is cleaned up — not only when the
   * playback's own eventEmitter is torn down. A WeakMap keeps the entry GC-
   * tied to the playback identity.
   */
  private _playbackUnsubscribes: WeakMap<Playback, Array<() => void>> = new WeakMap();
  /**
   * Primary route target for this Sound. `null` means master (the default —
   * preplay connects to {@link globalGainNode} which IS `master.input`).
   * When a Bus is assigned via {@link routeTo}, future playbacks connect to
   * `bus.input` instead, and live playbacks are rewired.
   */
  private _routeTarget: Bus | null = null;
  /**
   * Additional send edges established by {@link routeTo}(bus, sendGain).
   * Keyed by target bus → send gain value. At preplay we allocate one
   * GainNode per send per playback so each playback has its own send edges
   * (a per-Sound shared sendGain would crash the second simultaneous
   * playback because both gainNodes would connect into the same single
   * sendGain, doubling the dry signal). The actual GainNode lifecycle is
   * owned by each Playback in {@link Playback._sendGains} — iterable so
   * cleanup can walk every send and call `disconnect()`.
   */
  private _sends: Map<Bus, number> = new Map();

  constructor(
    public url: string,
    buffer: AudioBuffer | undefined,
    context: BaseContext,
    private globalGainNode: GainNode,
    public soundType: SoundType = "buffer",
    public panType: PanType = "HRTF",
    private _cacophony?: Cacophony,
  ) {
    super();
    this.buffer = buffer;
    this.context = context;
    this._cacophony?.registerSoundForCleanup(this, this._holdings, this._unregisterToken);
  }

  get cacophony(): Cacophony | undefined {
    return this._cacophony;
  }

  get volume(): number {
    return super.volume;
  }

  /**
   * Register event listener.
   * @returns Cleanup function
   */
  on<K extends keyof SoundEvents>(event: K, listener: (data: SoundEvents[K]) => void): () => void {
    return this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof SoundEvents>(event: K, listener: (data: SoundEvents[K]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  protected emit<K extends keyof SoundEvents>(event: K, data: SoundEvents[K]): void {
    this.eventEmitter.emit(event, data);
  }

  protected async emitAsync<K extends keyof SoundEvents>(event: K, data: SoundEvents[K]): Promise<void> {
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
   */

  clone(overrides: Partial<SoundCloneOverrides> = {}): Sound {
    const panType = overrides.panType ?? this.panType;
    const stereoPan = overrides.stereoPan !== undefined ? overrides.stereoPan : this.stereoPan;
    const loopCount = overrides.loopCount !== undefined ? overrides.loopCount : this.loopCount;
    const playbackRate = overrides.playbackRate ?? this.playbackRate;
    const volume = overrides.volume !== undefined ? overrides.volume : this.volume;
    const position = overrides.position !== undefined ? overrides.position : this.position;
    const filters = overrides.filters?.length ? overrides.filters : this._filters;

    const clone = new Sound(
      this.url,
      this.buffer,
      this.context,
      this.globalGainNode,
      this.soundType,
      panType,
      this.cacophony,
    );
    clone.loop(loopCount);
    clone.playbackRate = playbackRate;
    clone.volume = volume;
    if (panType === "HRTF") {
      // Apply HRTF override or inherit from source.
      if (overrides.threeDOptions !== undefined) {
        clone.threeDOptions = overrides.threeDOptions;
      } else if (this.panType === "HRTF") {
        clone.threeDOptions = this.threeDOptions;
      }
      clone.position = position;
    } else {
      clone.stereoPan = stereoPan;
    }
    clone.addFilters(filters);
    return clone;
  }

  /**
   * Generates a Playback instance for the sound without starting playback.
   * This allows for pre-configuration of playback properties such as volume and position before the sound is actually played.
   */

  preplay(): Playback[] {
    // Capture array lengths at entry so a throw mid-construction can truncate
    // back to exactly what was here before — this preplay call's pushes get
    // rolled back without touching prior entries.
    const sourcesLen = this._holdings.sources.length;
    const gainNodesLen = this._holdings.gainNodes.length;
    const mediaElementsLen = this._holdings.mediaElements.length;
    const playbacksLen = this.playbacks.length;
    // Track audio nodes created during this call so we can disconnect them on
    // rollback (the finalization registry won't see them since holdings are
    // truncated below).
    let createdSource: SourceNode | undefined;
    let createdGainNode: GainNode | undefined;
    try {
      let source: SourceNode;
      if (this.buffer) {
        source = this.context.createBufferSource();
        source.buffer = this.buffer;
      } else {
        if (!this.context.createMediaElementSource) {
          throw new Error(
            "Media element sources are not supported on this audio context (e.g. OfflineAudioContext). Use buffer-based sounds instead.",
          );
        }
        const audio = new Audio();
        audio.crossOrigin = "anonymous";
        audio.src = this.url;
        audio.preload = "auto";
        // we have the audio, let's make a buffer source node out of it
        source = this.context.createMediaElementSource(audio);
      }
      createdSource = source;
      const gainNode = this.context.createGain();
      createdGainNode = gainNode;
      // Resolve the primary route target. A null `_routeTarget` means master
      // — which is structurally `globalGainNode`. A destroyed bus falls back
      // to master with a warning.
      const primaryTargetNode = this._resolveRouteTargetNode();
      gainNode.connect(primaryTargetNode);
      const playback = new Playback(this, source, gainNode);
      // Establish send edges (per-playback allocation so each playback owns
      // its own send-gain nodes — see _sends docstring). The allocated
      // GainNode lives on the Playback (`playback._sendGains`) so it gets
      // torn down explicitly in Playback.cleanup().
      if (this._sends.size > 0) {
        for (const [bus, gainValue] of this._sends) {
          if (bus.destroyed) {
            console.warn(`Sound has a send to destroyed bus '${bus.name ?? "<anonymous>"}'; skipping`);
            continue;
          }
          const sendGain = this.context.createGain();
          sendGain.gain.value = gainValue;
          gainNode.connect(sendGain);
          sendGain.connect(bus.input);
          playback._sendGains.set(bus, sendGain);
        }
      }
      this._holdings.sources.push(source);
      this._holdings.gainNodes.push(gainNode);
      if ("mediaElement" in source && source.mediaElement) {
        this._holdings.mediaElements.push(source.mediaElement);
      }
      playback.setGainNode(gainNode);
      playback.volume = this.volume;
      playback.playbackRate = this.playbackRate;
      // Carry the Sound's pitch-shift factor onto the new playback. Building the
      // phase-vocoder worklet node is async; preplay is sync, so this is a
      // fire-and-forget that splices the node in once the worklet resolves
      // (no-op when no shift is set).
      if (this._pitchFactor !== 1) {
        void playback.setPitchShift(this._pitchFactor).catch(() => {
          /* worklet unavailable on this context — playback proceeds unshifted */
        });
      }
      // Clone filters from sound to playback (each playback gets independent filter instances)
      this._filters.forEach((filter) => {
        const clonedFilter = this.context.createBiquadFilter();
        clonedFilter.type = filter.type;
        clonedFilter.frequency.value = filter.frequency.value;
        clonedFilter.Q.value = filter.Q.value;
        clonedFilter.gain.value = filter.gain.value;
        playback.addFilter(clonedFilter);
      });
      if (this.panType === "HRTF") {
        playback.threeDOptions = this.threeDOptions;
        playback.position = this.position;
      } else if (this.panType === "stereo") {
        playback.stereoPan = this.stereoPan;
      }
      // Set up event propagation from playback to sound. Each listener captures
      // `this` and is registered on the playback's own emitter — so the
      // playback holds a reference back to the Sound for the lifetime of the
      // listener. Capture the unsubscribe functions so we can break the cycle
      // explicitly when the playback ends (naturally) or is cleaned up.
      const unsubEnded = playback.on("ended", () => {
        this.emit("ended", undefined);
        // Natural end: the playback has fired its terminal event; tear down
        // our subscriptions so it can be GC'd without waiting for cleanup().
        // Deferred to a microtask because the emitter re-assigns its listener
        // array AFTER the synchronous forEach iteration completes — calling
        // off() inside the listener would have its removal overwritten by
        // that re-assignment (see TypedEventEmitter.emit). The microtask
        // defers the off() until after the emit cycle settles.
        queueMicrotask(() => this._unsubscribeFromPlayback(playback));
      });
      playback._loopEndCallback = () => {
        this.emit("loopEnd", undefined);
      };
      const unsubError = playback.on("error", (errorEvent) => {
        this.emitAsync("soundError", {
          url: this.url,
          error: errorEvent.error,
          errorType: "playback",
          timestamp: errorEvent.timestamp,
          recoverable: errorEvent.recoverable,
        });
      });
      // Clear-the-callback step counts as an "unsubscribe" for the closure
      // _loopEndCallback holds (it captures `this`). Combine all three.
      const clearLoopCallback = () => {
        if (playback._loopEndCallback) {
          playback._loopEndCallback = undefined;
        }
      };
      this._playbackUnsubscribes.set(playback, [unsubEnded, unsubError, clearLoopCallback]);

      this.playbacks.push(playback);
      return [playback];
    } catch (error) {
      // Roll back any state pushed during THIS call so a failed preplay does
      // not leave zombie holdings/playbacks behind. Truncate to entry lengths
      // first (safe even if we never reached the pushes), then disconnect the
      // audio nodes we actually created.
      this._holdings.sources.length = sourcesLen;
      this._holdings.gainNodes.length = gainNodesLen;
      this._holdings.mediaElements.length = mediaElementsLen;
      this.playbacks.length = playbacksLen;
      if (createdGainNode) {
        try {
          createdGainNode.disconnect();
        } catch {
          // Disconnect can throw if the node was never connected; the rollback
          // intent is satisfied regardless.
        }
      }
      if (createdSource) {
        try {
          createdSource.disconnect();
        } catch {
          // Same — best-effort cleanup on a failed-construction path.
        }
      }
      const errorEvent = {
        url: this.url,
        error: error as Error,
        errorType: "playback" as const,
        timestamp: Date.now(),
        recoverable: true,
      };
      this.emitAsync("soundError", errorEvent);
      throw error;
    }
  }

  /**
   * Detaches the Sound-side listeners that were registered on a playback in
   * {@link preplay}. Idempotent — safe to call on a playback whose
   * subscriptions were already torn down. Breaks the Sound↔playback closure
   * cycle described on the entries in {@link _playbackUnsubscribes}.
   */
  private _unsubscribeFromPlayback(playback: Playback): void {
    const unsubs = this._playbackUnsubscribes.get(playback);
    if (!unsubs) {
      return;
    }
    this._playbackUnsubscribes.delete(playback);
    for (const unsub of unsubs) {
      unsub();
    }
  }

  play(options?: PlayOptions): ReturnType<this["preplay"]> {
    const playbacks = this.preplay() as ReturnType<this["preplay"]>;

    for (const playback of playbacks) {
      const emitSoundPlay = (acceptedPlayback: SoundEvents["play"]) => {
        cleanupPlayListeners();
        this.emit("play", acceptedPlayback);
      };
      const cleanupPlayListeners = () => {
        playback.off("play", emitSoundPlay);
        playback.off("error", cleanupPlayListeners);
      };

      playback.on("play", emitSoundPlay);
      playback.on("error", cleanupPlayListeners);

      try {
        playback.play();
      } catch (error) {
        cleanupPlayListeners();
        // preplay() already committed `playback` to `this.playbacks` and the
        // Sound→playback listener subscriptions. Remove both so the failed
        // playback is not re-touched by subsequent resume()/loop() iterations
        // and so the closure cycle is broken on the throw path too.
        const idx = this.playbacks.indexOf(playback);
        if (idx !== -1) {
          this.playbacks.splice(idx, 1);
        }
        this._unsubscribeFromPlayback(playback);
        throw error;
      }
    }

    if (options) {
      for (const playback of playbacks) {
        if (options.fadeIn !== undefined) {
          playback.fadeIn(options.fadeIn, options.fadeType, { perLoop: options.fadeInPerLoop });
        }
        if (options.fadeOut !== undefined) {
          playback.configureFadeOut(options.fadeOut, options.fadeType);
        }
      }
    }

    return playbacks;
  }

  stop(): void {
    this._holdings.sources.length = 0;
    this._holdings.gainNodes.length = 0;
    this._holdings.mediaElements.length = 0;
    super.stop();
    this.emit("stop", undefined);
  }

  pause(): void {
    super.pause();
    this.emit("pause", undefined);
  }

  resume(): void {
    this.playbacks.forEach((playback) => playback.play());
    this.emit("resume", undefined);
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
   * OFFLINE independent time-stretch: produce a NEW buffer-based Sound whose
   * tempo is changed by `factor` WITHOUT changing pitch (Phase Gradient Heap
   * Integration, Průša & Holighaus, "Phase Vocoder Done Right", EUSIPCO 2017 /
   * arXiv:2202.07382). `factor > 1` is slower/longer, `factor < 1` is
   * faster/shorter. Only valid for buffer-based sounds (a loaded AudioBuffer);
   * streaming / media-element sounds have no decoded buffer to transform.
   *
   * The original Sound is left untouched; a fresh Sound wrapping the stretched
   * buffer is returned. Delegates to {@link Cacophony.timeStretchBuffer}.
   *
   * @param factor Stretch factor (`> 0`); pitch is preserved.
   * @param options Optional PGHI parameters (fftSize, analysisHop, tol, seed).
   * @returns A new buffer-based Sound at the stretched tempo.
   * @throws If this Sound has no AudioBuffer (e.g. streaming/HTML5 audio).
   */
  timeStretch(factor: number, options?: TimeStretchOptions): Sound {
    if (!this.buffer) {
      throw new Error("Sound.timeStretch requires a buffer-based sound (a loaded AudioBuffer).");
    }
    if (!this._cacophony) {
      throw new Error("Sound.timeStretch requires the owning Cacophony instance.");
    }
    const stretched = this._cacophony.timeStretchBuffer(this.buffer, factor, options);
    return new Sound(this.url, stretched, this.context, this.globalGainNode, "buffer", this.panType, this._cacophony);
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

  /**
   * Current pitch-shift factor (1 = no shift). See {@link setPitchShift}.
   */
  get pitchShift(): number {
    return this._pitchFactor;
  }

  /**
   * Pitch-shifts every live playback of this Sound, resurrecting the dormant
   * phase-vocoder worklet (Jean Laroche & Mark Dolson, 1999 IEEE WASPAA —
   * peak-based pitch shift with Identity Phase-Locking). Mirrors how
   * {@link playbackRate} fans a per-playback control out across `this.playbacks`.
   * The factor is also stored so future playbacks pick it up at preplay.
   *
   * @param factor Pitch multiplier (> 0; 2 = +1 octave, 0.5 = -1 octave).
   * @returns Resolves once every live playback's worklet node has been built
   *   and its `pitchFactor` param updated.
   */
  async setPitchShift(factor: number): Promise<void> {
    // Validate UP FRONT, before storing. With no live playbacks `Promise.all([])`
    // resolves immediately, so a missing guard here would let setPitchShift(0)
    // / NaN / negative "succeed" and leave an invalid pitchShift on the Sound
    // that future preplay() would silently swallow. Mirrors the per-playback
    // guard in Playback.setPitchShift.
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error("Pitch-shift factor must be greater than 0");
    }
    this._pitchFactor = factor;
    await Promise.all(this.playbacks.map((p) => p.setPitchShift(factor)));
  }

  /**
   * Routes this Sound to a Bus (or back to master). Two modes:
   *
   * - `routeTo(target)` — replace primary routing. Live playbacks are
   *   rewired: each playback's outputNode is disconnected from its current
   *   target and re-connected to the new target's input. Future playbacks
   *   read the stored target at preplay.
   * - `routeTo(target, sendGain)` — ADD a send (does not change primary
   *   routing). An additional edge is created from each live playback
   *   through an allocated GainNode set to `sendGain`. Future playbacks
   *   get the same send at preplay.
   *
   * `target` may be a Bus instance or the name of a registered bus (string
   *  lookup via `cacophony.getBus`). A string with no matching bus throws.
   *
   * Passing the master bus (or `cacophony.master`) as `target` (no
   *  sendGain) is the canonical way to reset primary routing back to master.
   */
  routeTo(target: Bus | string, sendGain?: number): void {
    const bus = this._resolveBusArg(target);
    if (sendGain !== undefined) {
      this._addSend(bus, sendGain);
      return;
    }
    this._setPrimary(bus);
  }

  private _resolveBusArg(target: Bus | string): Bus {
    if (typeof target !== "string") {
      return target;
    }
    const bus = this._cacophony?.getBus(target);
    if (!bus) {
      throw new Error(`No bus registered with name '${target}'`);
    }
    return bus;
  }

  /**
   * Returns the AudioNode that future playbacks should connect to as their
   * primary target. Handles the master bus alias and the destroyed-bus
   * fallback (which warns).
   */
  _resolveRouteTargetNode(): GainNode {
    if (!this._routeTarget) {
      return this.globalGainNode;
    }
    if (this._routeTarget.destroyed) {
      console.warn(
        `Sound routed to destroyed bus '${this._routeTarget.name ?? "<anonymous>"}'; falling back to master`,
      );
      return this.globalGainNode;
    }
    return this._routeTarget.input;
  }

  /**
   * Apply a new primary route. If a bus is passed and it's the master bus,
   * collapse to `null` so the canonical "route to master" representation is
   * always `null` (matches the default).
   *
   * @throws if `bus` is destroyed. Symmetric with {@link _addSend}'s guard;
   *   a destroyed bus is an invalid mutation target. (Sounds already routed
   *   BEFORE the bus was destroyed still fall back to master at preplay via
   *   {@link _resolveRouteTargetNode} — that path is separate.)
   */
  private _setPrimary(bus: Bus): void {
    if (bus.destroyed) {
      throw new Error(`Cannot route to destroyed bus '${bus.name ?? "<anonymous>"}'`);
    }
    // master.input === globalGainNode — normalize to null in either case so
    // there is one canonical "route to master" state.
    const collapseToMaster = bus.input === this.globalGainNode;
    const oldTarget = this._routeTarget;
    const oldTargetNode = this._resolveRouteTargetNode();
    this._routeTarget = collapseToMaster ? null : bus;
    const newTarget = this._routeTarget;
    const newTargetNode = this._resolveRouteTargetNode();
    // Maintain inbound source-tracking driven by the route-target BUS IDENTITY,
    // independent of whether the resolved AudioNode changed. A bus-identity
    // transition (e.g. off a destroyed bus that resolves to globalGainNode, onto
    // master which is ALSO globalGainNode) leaves the resolved nodes equal — so
    // this must run BEFORE the node-equality early-return below, or the
    // unregister of the old bus is skipped and the sound leaks in the old bus's
    // `_routedSources`. (master/null is excluded because it is `null`.)
    if (oldTarget !== newTarget) {
      if (oldTarget && !this._sends.has(oldTarget)) {
        oldTarget._unregisterRoutedSource(this);
      }
      if (newTarget) {
        newTarget._registerRoutedSource(this);
      }
    }
    // The node-equality guard gates only the live-playback rewire: when the
    // resolved primary AudioNode is unchanged there is nothing to disconnect/
    // reconnect. Registration bookkeeping has already been settled above.
    if (oldTargetNode === newTargetNode) {
      return;
    }
    for (const playback of this.playbacks) {
      try {
        playback.outputNode.disconnect(oldTargetNode);
      } catch {
        // Some playbacks may already have been disconnected (cleanup, manual
        // disconnect). Tolerate.
      }
      try {
        playback.outputNode.connect(newTargetNode);
      } catch {
        // Best-effort live rewire.
      }
    }
  }

  private _addSend(bus: Bus, gainValue: number): void {
    if (bus.destroyed) {
      throw new Error(`Cannot add a send to destroyed bus '${bus.name ?? "<anonymous>"}'`);
    }
    this._sends.set(bus, gainValue);
    // A sound that sends to a bus is an inbound source of it too, so it must
    // be drained off when the bus is torn down.
    bus._registerRoutedSource(this);
    // Establish send edges on existing playbacks. The per-playback Map is
    // the canonical owner of the GainNode lifecycle (so cleanup can iterate
    // and disconnect every send).
    for (const playback of this.playbacks) {
      const existing = playback._sendGains.get(bus);
      if (existing) {
        existing.gain.value = gainValue;
        continue;
      }
      const sendGain = this.context.createGain();
      sendGain.gain.value = gainValue;
      try {
        playback.outputNode.connect(sendGain);
      } catch {
        // Playback may have been cleaned up; skip.
        continue;
      }
      sendGain.connect(bus.input);
      playback._sendGains.set(bus, sendGain);
    }
  }

  /**
   * Reroute this sound off `bus` onto `target` when `bus` is being drained
   * (typically just before it is destroyed). A sound may be BOTH primary-routed
   * to `bus` AND have a send to it — both edges move.
   */
  _onBusDrained(bus: Bus, target: Bus): void {
    // Primary route: reuse _setPrimary so live playbacks are rewired and the
    // source-registration (un)registers through the normal path.
    if (this._routeTarget === bus) {
      this._setPrimary(target);
    }
    // Send: capture the gain, tear down the old send (map entry + per-playback
    // GainNode for `bus`), then re-establish an equivalent send to `target`.
    if (this._sends.has(bus)) {
      const gainValue = this._sends.get(bus) as number;
      this._sends.delete(bus);
      for (const playback of this.playbacks) {
        const sendGain = playback._sendGains.get(bus);
        if (!sendGain) {
          continue;
        }
        // Same per-playback send-teardown shape as Playback.cleanup.
        try {
          sendGain.disconnect();
        } catch {
          // Best-effort — node may already have been disconnected externally.
        }
        playback._sendGains.delete(bus);
      }
      this._addSend(target, gainValue);
    }
  }

  cleanup(): void {
    this._cacophony?.unregisterSoundCleanup(this._unregisterToken);
    // Drop ourselves from the source-tracking of every bus we route to, so a
    // later drain/destroy of that bus does not touch this dead sound.
    if (this._routeTarget) {
      this._routeTarget._unregisterRoutedSource(this);
    }
    for (const bus of this._sends.keys()) {
      bus._unregisterRoutedSource(this);
    }
    this._holdings.sources.length = 0;
    this._holdings.gainNodes.length = 0;
    this._holdings.mediaElements.length = 0;
    // Explicitly tear down the Sound→playback listener subscriptions before
    // calling p.cleanup() — p.cleanup()'s removeAllListeners() also clears
    // them, but doing it here keeps the closure cycle's break point local to
    // Sound and ensures the WeakMap entries are released promptly.
    this.playbacks.forEach((p) => {
      this._unsubscribeFromPlayback(p);
      p.cleanup();
    });
    this.playbacks = [];
    this.eventEmitter.removeAllListeners();
  }
}
