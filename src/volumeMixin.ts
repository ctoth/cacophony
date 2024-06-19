import { GainNode } from "./context";

type Constructor<T = {}> = new (...args: any[]) => T;

export function VolumeMixin<TBase extends Constructor>(Base: TBase) {
    return class extends Base {
        private gainNode?: GainNode;

        setGainNode(gainNode: GainNode) {
            this.gainNode = gainNode;
        }

        get volume(): number {
            if (!this.gainNode) {
                throw new Error('Cannot get volume of a sound that has been cleaned up');
            }
            return this.gainNode.gain.value;
        }

        set volume(v: number) {
            if (!this.gainNode) {
                throw new Error('Cannot set volume of a sound that has been cleaned up');
            }
            this.gainNode.gain.value = v;
        }
    };
}
