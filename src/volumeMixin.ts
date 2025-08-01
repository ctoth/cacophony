import { GainNode } from "./context";
import { FilterManager } from "./filters";

export type VolumeCloneOverrides = {
    volume?: number;
};

type Constructor<T = FilterManager> = abstract new (...args: any[]) => T;

export function VolumeMixin<TBase extends Constructor>(Base: TBase) {
    abstract class VolumeMixin extends Base {
        gainNode?: GainNode;

        setGainNode(gainNode: GainNode) {
            this.gainNode = gainNode;
        }

        cleanup(): void {
            if (this.gainNode) {
                this.gainNode.disconnect();
                this.gainNode = undefined;
            }
            super.cleanup();
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
