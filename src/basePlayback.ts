import { IPlaybackContainer } from "./container";
import { AudioNode } from "./context";
import { FilterManager } from "./filters";
import { PannerMixin } from "./pannerMixin";
import { VolumeMixin } from "./volumeMixin";
import { TypedEventEmitter } from "./eventEmitter";
import { PlaybackEvents } from "./events";

export abstract class BasePlayback extends PannerMixin(
  VolumeMixin(FilterManager)
) {
  public source?: AudioNode;
  _playing: boolean = false;
  public origin!: IPlaybackContainer;
  protected eventEmitter: TypedEventEmitter<PlaybackEvents> = new TypedEventEmitter<PlaybackEvents>();

  constructor() {
    super();
    
  }

  abstract play(): [this];
  abstract pause(): void;
  abstract stop(): void;

  /**
   * Checks if the audio is currently playing.
   * @returns {boolean} True if the audio is playing, false otherwise.
   */

  get isPlaying(): boolean {
    if (!this.source) {
      return false;
    }
    return this._playing;
  }

  /**
   * Register event listener.
   * @returns Cleanup function
   */
  on<K extends keyof PlaybackEvents>(event: K, listener: (data: PlaybackEvents[K]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof PlaybackEvents>(event: K, listener: (data: PlaybackEvents[K]) => void): void {
    this.eventEmitter.off(event, listener);
  }


  protected emit<K extends keyof PlaybackEvents>(event: K, data: PlaybackEvents[K]): void {
    this.eventEmitter.emit(event, data);
  }

  protected async emitAsync<K extends keyof PlaybackEvents>(
    event: K,
    data: PlaybackEvents[K]
  ): Promise<void> {
    return this.eventEmitter.emitAsync(event, data);
  }


  cleanup(): void {
    this.eventEmitter.removeAllListeners();
    super.cleanup();
  }
}
