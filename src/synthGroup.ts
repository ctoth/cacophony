import { Synth } from './synth';

export class SynthGroup {

    constructor(public synths: Synth[] = []) { }

    addSynth(synth: Synth) {
        this.synths.push(synth);
    }

    removeSynth(synth: Synth) {
        const index = this.synths.indexOf(synth);
        if (index !== -1) {
            this.synths.splice(index, 1);
        } else {
            throw new Error('Synth not found in group');
        }
    }

    play() {
        this.synths.forEach(synth => synth.play());
    }

    stop() {
        this.synths.forEach(synth => synth.stop());
    }

    setVolume(volume: number) {
        this.synths.forEach(synth => synth.volume = volume);
    }

    set stereoPan(pan: number) {
        this.synths.forEach(synth => synth.stereoPan = pan);
    }

    set position(position: [number, number, number]) {
        this.synths.forEach(synth => synth.position = position);
    }
}
