import { IAudioContext } from "standardized-audio-context";
import { ADSR, ADSREnvelope } from "./adsr";
import { GainNode } from "./context";
import { FilterManager } from "./filters";

export type VolumeCloneOverrides = {
    volume?: number;
};

type Constructor<T = FilterManager> = abstract new (...args: any[]) => T;

export function VolumeMixin<TBase extends Constructor>(Base: TBase) {
    abstract class VolumeMixin extends Base {
        gainNode?: GainNode;
        envelopes: VolumeEnvelopes = {};
        declare public context: IAudioContext;

        setGainNode(gainNode: GainNode) {
            this.gainNode = gainNode;
        }

        /**
        * Gets the current volume of the audio.
        * @throws {Error} Throws an error if the sound has been cleaned up.
        * @returns {number} The current volume.
        */

        get volume(): number {
            if (!this.gainNode) {
                throw new Error('Cannot get volume of a sound that has been cleaned up');
            }
            return this.gainNode.gain.value;
        }

        /**
        * Sets the volume of the audio.
        * @param {number} v - The volume to set.
        * @throws {Error} Throws an error if the sound has been cleaned up.
        */

        set volume(v: number) {
            if (!this.gainNode) {
                throw new Error('Cannot set volume of a sound that has been cleaned up');
            }
            this.gainNode.gain.value = v;
        }

        // apply envelope
        applyVolumeEnvelope(envelope: ADSREnvelope): void {
            if (!this.gainNode) {
                throw new Error('Cannot apply volume envelope to a sound that has been cleaned up');
            }
            const instance = new ADSR(envelope);
            instance.applyToParam(this.gainNode.gain, this.context.currentTime, envelope.duration);
        }
    };

    return VolumeMixin;
}

interface VolumeEnvelopes {
    volumeEnvelope?: ADSR;
}