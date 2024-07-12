import type { BaseSound, PanType } from "./cacophony";
import type { AudioContext, GainNode, OscillatorNode } from "./context";
import { FilterManager } from "./filters";
import { OscillatorMixin } from "./oscillatorMixin";
import { PannerMixin } from "./pannerMixin";
import { VolumeMixin } from "./volumeMixin";
import { SynthEnvelopes } from "./synth";

export class SynthPlayback extends OscillatorMixin(PannerMixin(VolumeMixin(FilterManager))) implements BaseSound {
    synthEnvelopes: SynthEnvelopes = {};

    constructor(public source: OscillatorNode, gainNode: GainNode, public context: AudioContext, panType: PanType = 'HRTF') {
        super()
        this.setPanType(panType, context)
        this.source.connect(this.panner!);
        this.setGainNode(gainNode)
        this.panner!.connect(this.gainNode!);
        this.refreshFilters()
    }

    /**
    * Refreshes the audio filters by re-applying them to the audio signal chain.
    * This method is called internally whenever filters are added or removed.
    * @throws {Error} Throws an error if the sound has been cleaned up.
    */

    private refreshFilters(): void {
        if (!this.panner || !this.gainNode) {
            throw new Error('Cannot update filters on a sound that has been cleaned up');
        }
        let connection = this.panner;
        connection.disconnect();
        connection = this.applyFilters(connection);
        connection.connect(this.gainNode);
    }
}
