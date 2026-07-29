import type { Bus } from "./bus";
import type { FadeType } from "./cacophony";
import type { PlaybackContainer } from "./container";
import type { AudioNode, GainNode } from "./context";
import { TypedEventEmitter } from "./eventEmitter";
import type { PlaybackEvents } from "./events";
import { FilterManager } from "./filters";
import { PannerMixin } from "./pannerMixin";
import { VolumeMixin } from "./volumeMixin";

export type PlaybackState = "unplayed" | "playing" | "paused" | "stopped";

export abstract class BasePlayback extends PannerMixin(VolumeMixin(FilterManager)) {
  public source?: AudioNode;
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

  abstract play(): [this];
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
  fadeTo(value: number, duration: number, type: FadeType = "linear"): Promise<void> {
    this.emit("fadeStart", { target: value, duration, type });
    return super.fadeTo(value, duration, type).then(() => {
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
    this.eventEmitter.removeAllListeners();
    super.cleanup();
  }
}
