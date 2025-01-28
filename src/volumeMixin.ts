import { AudioNode, GainNode } from "./context";
import { FilterManager } from "./filters";

export type VolumeCloneOverrides = {
    volume?: number;
};

type Constructor<T = FilterManager> = abstract new (...args: any[]) => T;

export function VolumeMixin<TBase extends Constructor>(Base: TBase) {
    abstract class VolumeMixin extends Base {
        gainNode?: GainNode;

        get inputNode(): AudioNode {
            if (!this.gainNode) {
                throw new Error('Cannot access nodes of a cleaned up sound');
            }
            return this.gainNode;
        }

        get outputNode(): AudioNode {
            if (!this.gainNode) {
                throw new Error('Cannot access nodes of a cleaned up sound');
            }
            return this.gainNode;
        }

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

    };

    return VolumeMixin;
}
