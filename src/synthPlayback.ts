import type { BaseSound } from "./cacophony";
import type { AudioContext, GainNode, OscillatorNode } from "./context";
import { FilterManager } from "./filters";
import { OscillatorMixin } from "./oscillatorMixin";
import { PannerMixin } from "./pannerMixin";
import { Synth } from "./synth";
import { VolumeMixin } from "./volumeMixin";

export class SynthPlayback
  extends OscillatorMixin(PannerMixin(VolumeMixin(FilterManager)))
  implements BaseSound
{
  context: AudioContext;
  constructor(
    public origin: Synth,
    public source: OscillatorNode,
    gainNode: GainNode
  ) {
    super();
    this.context = origin.context;
    this.setPanType(origin.panType, origin.context);
    this.source.connect(this.panner!);
    this.setGainNode(gainNode);
    this.panner!.connect(this.gainNode!);
    this.refreshFilters();
  }

  /**
   * Refreshes the audio filters by re-applying them to the audio signal chain.
   * This method is called internally whenever filters are added or removed.
   * @throws {Error} Throws an error if the synth has been cleaned up.
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

  cleanup(): void {
    if (this.panner && this.gainNode) {
      this.source.disconnect(this.panner);
      this.panner.disconnect();
      this.gainNode.disconnect();
    }
    this.eventEmitter.removeAllListeners();
  }
}
