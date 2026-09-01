import type { Bus } from "./bus";
import type { FadeType, PlayOptions } from "./cacophony";
import type { PlaybackContainer } from "./container";
import type { AudioNode, BaseContext, BiquadFilterNode, GainNode } from "./context";
import { EffectChain } from "./effectChain";
import type { CacophonyEffect } from "./effects";
import { TypedEventEmitter } from "./eventEmitter";
import type { PlaybackEvents } from "./events";
import { FilterManager } from "./filters";
import { PannerMixin } from "./pannerMixin";
import { VolumeMixin } from "./volumeMixin";

export type PlaybackState = "unplayed" | "playing" | "paused" | "stopped";

export abstract class BasePlayback extends PannerMixin(VolumeMixin(FilterManager)) {
  public source?: AudioNode;
  protected _effectChain?: EffectChain;
  private _effectContext?: BaseContext;
  /**
   * Per-playback send-gain allocations owned by the shared routing state
   * machine. Cleanup disconnects every allocation deterministically.
   */
  _sendGains: Map<Bus, GainNode> = new Map();
  protected _state: PlaybackState = "unplayed";
  public origin: PlaybackContainer;
  public eventEmitter: TypedEventEmitter<PlaybackEvents> = new TypedEventEmitter<PlaybackEvents>();

  constructor(origin: PlaybackContainer) {
    super();
    this.origin = origin;
  }

  protected setEffectChainEndpoints(input: AudioNode, output: AudioNode): void {
    this._effectContext =
      (input.context as BaseContext | undefined) ??
      (this.origin as PlaybackContainer & { context?: BaseContext }).context;
    if (this._effectChain) {
      this._effectChain.setEndpoints(input, output);
      return;
    }
    this._effectChain = new EffectChain(input, output, this.constructor.name);
  }

  /** Build and splice an effect into this live playback's pre-panner chain. */
  addEffect(effect: CacophonyEffect): Promise<AudioNode> {
    try {
      return this.materializeEffect(effect);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** @internal Source preplay path that preserves synchronous native-build failures. */
  _addSourceEffect(effect: CacophonyEffect): Promise<AudioNode> {
    return this.materializeEffect(effect);
  }

  /** @internal Materialize a source-level biquad recipe and retain filter API compatibility. */
  _addFilterEffect(effect: CacophonyEffect): Promise<AudioNode> {
    return this.materializeEffect(effect, (handle) => {
      this._filters.push(handle as BiquadFilterNode);
    });
  }

  private materializeEffect(effect: CacophonyEffect, onBuilt?: (handle: AudioNode) => void): Promise<AudioNode> {
    if (!this._effectChain || !this._effectContext) {
      throw new Error("Cannot add an effect before the playback effect chain is initialized");
    }
    const chain = this._effectChain;
    const reservation = chain.reserve();
    let built;
    try {
      built = effect.build(this._effectContext);
    } catch (error) {
      chain.cancel(reservation);
      throw error;
    }
    if (built instanceof Promise || (typeof built === "object" && built !== null && "then" in built)) {
      return Promise.resolve(built).then(
        (resolved) => {
          const handle = chain.resolve(reservation, resolved);
          onBuilt?.(handle);
          return handle;
        },
        (error) => {
          chain.cancel(reservation);
          throw error;
        },
      );
    }
    try {
      const handle = chain.resolve(reservation, built);
      onBuilt?.(handle);
      return Promise.resolve(handle);
    } catch (error) {
      chain.cancel(reservation);
      throw error;
    }
  }

  rampEffectParam(
    handle: AudioNode,
    paramName: string,
    value: number,
    options?: { duration?: number; type?: FadeType },
  ): void {
    if (!this._effectChain) {
      throw new Error("Cannot automate an effect before the playback effect chain is initialized");
    }
    this._effectChain.rampParam(handle, paramName, value, options);
  }

  addFilter(filter: BiquadFilterNode): void {
    if (!this._effectChain) {
      throw new Error("Cannot add a filter before the playback effect chain is initialized");
    }
    this._effectChain.add(filter, this._filters.length);
    this._filters.push(filter);
  }

  removeFilter(filter: BiquadFilterNode): void {
    if (!this._effectChain) {
      throw new Error("Cannot remove a filter before the playback effect chain is initialized");
    }
    this._effectChain.remove(filter);
    this._filters = this._filters.filter((candidate) => candidate !== filter);
  }

  setFilterOrder(filters: readonly BiquadFilterNode[]): void {
    if (!this._effectChain) {
      throw new Error("Cannot reorder filters before the playback effect chain is initialized");
    }
    const nonFilters = this._effectChain.nodes.filter((node) => !this._filters.includes(node as BiquadFilterNode));
    this._effectChain.setOrder([...filters, ...nonFilters]);
    this._filters = [...filters];
  }

  setFilterBypassed(filter: BiquadFilterNode, bypassed: boolean): void {
    if (!this._effectChain) {
      throw new Error("Cannot bypass a filter before the playback effect chain is initialized");
    }
    this._effectChain.setBypassed(filter, bypassed);
  }

  isFilterBypassed(filter: BiquadFilterNode): boolean {
    return this._effectChain?.isBypassed(filter) ?? false;
  }

  rampFilterParam(
    filter: BiquadFilterNode,
    paramName: string,
    value: number,
    options?: { duration?: number; type?: FadeType },
  ): void {
    if (!this._effectChain) {
      throw new Error("Cannot automate a filter before the playback effect chain is initialized");
    }
    this._effectChain.rampParam(filter, paramName, value, options);
  }

  abstract play(options?: PlayOptions): [this];
  abstract pause(): void;
  abstract stop(): void;

  /**
   * Checks if the audio is currently playing.
   */

  get isPlaying(): boolean {
    return this._state === "playing";
  }

  get isPaused(): boolean {
    return this._state === "paused";
  }

  protected markPlaying(): void {
    this._state = "playing";
  }

  protected markPaused(): void {
    this._state = "paused";
  }

  protected markStopped(): void {
    this._state = "stopped";
  }

  protected emitPlayStarted(isResume: boolean): void {
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

  protected emitPaused(): void {
    this.markPaused();
    this.emit("pause", undefined);
    this.origin.cacophony?.emit("globalPause", {
      source: this.origin,
      timestamp: Date.now(),
    });
  }

  protected emitStopped(): void {
    this.markStopped();
    this.emit("stop", undefined);
    this.origin.cacophony?.emit("globalStop", {
      source: this.origin,
      timestamp: Date.now(),
    });
  }

  /**
   * Register event listener.
   * @returns Cleanup function
   */
  on<K extends keyof PlaybackEvents>(event: K, listener: (data: PlaybackEvents[K]) => void): () => void {
    return this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof PlaybackEvents>(event: K, listener: (data: PlaybackEvents[K]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  public emit<K extends keyof PlaybackEvents>(event: K, data: PlaybackEvents[K]): void {
    this.eventEmitter.emit(event, data);
  }

  public async emitAsync<K extends keyof PlaybackEvents>(event: K, data: PlaybackEvents[K]): Promise<void> {
    return this.eventEmitter.emitAsync(event, data);
  }

  /**
   * Fades the volume to a target value, emitting fadeStart and fadeEnd events.
   */
  fadeTo(
    value: number,
    duration: number,
    type: FadeType = "linear",
    options?: { startTime?: number; startValue?: number },
  ): Promise<void> {
    this.emit("fadeStart", { target: value, duration, type });
    return super.fadeTo(value, duration, type, options).then(() => {
      this.emit("fadeEnd", undefined);
    });
  }

  /**
   * Cancels any in-progress fade, emitting fadeCancel if a fade was active.
   */
  cancelFade(): void {
    const wasFading = this._isFading;
    super.cancelFade();
    if (wasFading) {
      this.emit("fadeCancel", undefined);
    }
  }

  cleanup(): void {
    for (const sendGain of this._sendGains.values()) {
      try {
        sendGain.disconnect();
      } catch {
        // The node may already have been disconnected externally.
      }
    }
    this._sendGains.clear();
    this._effectChain?.destroy();
    this._effectChain = undefined;
    this._effectContext = undefined;
    this.eventEmitter.removeAllListeners();
    super.cleanup();
  }
}
