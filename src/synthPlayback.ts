import type { BaseSound, PanType } from "./cacophony";
import type { AudioContext, GainNode, OscillatorNode } from "./context";
import { FilterManager } from "./filters";
import { LFO } from "./lfo";
import { OscillatorMixin } from "./oscillatorMixin";
import { PannerMixin } from "./pannerMixin";
import { VolumeMixin } from "./volumeMixin";
import { SynthEnvelopes } from "./synth";

export class SynthPlayback extends OscillatorMixin(PannerMixin(VolumeMixin(FilterManager))) implements BaseSound {
    synthEnvelopes: SynthEnvelopes = {};
    frequencyLFO?: LFO;
    detuneLFO?: LFO;
    volumeLFO?: LFO;

    constructor(public source: OscillatorNode, public gainNode: GainNode, public context: AudioContext, panType: PanType = 'HRTF') {
        super()
        this.setPanType(panType, context)
        this.source.connect(this.panner!);
        this.setGainNode(gainNode)
        this.panner!.connect(this.gainNode!);
        this.refreshFilters()
    }

    setFrequencyLFO(lfo: LFO): void {
        if (this.frequencyLFO) {
            this.frequencyLFO.disconnect();
        }
        this.frequencyLFO = lfo;
        this.frequencyLFO.connect(this.source.frequency);
    }

    setDetuneLFO(lfo: LFO): void {
        if (this.detuneLFO) {
            this.detuneLFO.disconnect();
        }
        this.detuneLFO = lfo;
        this.detuneLFO.connect(this.source.detune);
    }

    setVolumeLFO(lfo: LFO): void {
        if (this.volumeLFO) {
            this.volumeLFO.disconnect();
        }
        this.volumeLFO = lfo;
        this.volumeLFO.connect(this.gainNode.gain);
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
