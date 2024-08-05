import { IPlaybackContainer } from "./container";
import { AudioNode } from "./context";
import { FilterManager } from "./filters";
import { PannerMixin } from "./pannerMixin";
import { VolumeMixin } from "./volumeMixin";

export abstract class BasePlayback extends PannerMixin(
  VolumeMixin(FilterManager)
) {
  public source?: AudioNode;
  _playing: boolean = false;
  public origin!: IPlaybackContainer;

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
}
