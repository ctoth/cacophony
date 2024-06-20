import { BaseSound, PanType } from "./cacophony";
import type { AudioContext, GainNode } from "./context";
import { OscillatorNode } from "./context";
import { FilterManager } from "./filters";
import { OscillatorMixin } from "./oscillatorMixin";
import { PannerMixin } from "./pannerMixin";
import { VolumeMixin } from "./volumeMixin";

export class SynthPlayback extends OscillatorMixin(PannerMixin(VolumeMixin(FilterManager))) implements BaseSound {
    constructor(public source: OscillatorNode, gainNode: GainNode, private context: AudioContext, panType: PanType = 'HRTF') {
        super()
        this.setPanType(panType, context)
        this.setGainNode(gainNode)
    }
}
