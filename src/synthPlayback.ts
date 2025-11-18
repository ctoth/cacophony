import type { BaseSound } from "./cacophony";
import type { AudioContext, GainNode, OscillatorNode } from "./context";
import { FilterManager } from "./filters";
import { OscillatorMixin } from "./oscillatorMixin";
import { PannerMixin } from "./pannerMixin";
import type { Synth } from "./synth";
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
    this.panner?.connect(this.gainNode!);
    this.refreshFilters();
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
