import { IPlaybackContainer } from "./container";
import { AudioNode, AudioParam } from "./context";
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
  abstract cleanup(): void;

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
   * Gets the first node in the audio chain that can receive input
   */
  abstract get inputNode(): AudioNode;

  /**
   * Gets the final node in the audio chain
   */
  abstract get outputNode(): AudioNode;

  /**
   * Connects the output to an audio node or param
   */
  connect(destination: AudioNode | AudioParam): void {
    if (!this.source) {
      throw new Error('Cannot access nodes of a cleaned up sound');
    }
    this.outputNode.connect(destination);
  }

  /**
   * Disconnects all outputs
   */
  disconnect(): void {
    if (!this.source) {
      throw new Error('Cannot access nodes of a cleaned up sound');
    }
    this.outputNode.disconnect();
  }
}
