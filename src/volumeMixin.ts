import { GainNode } from "./context";
import { FilterManager } from "./filters";
import type { FadeType } from "./cacophony";

export type VolumeCloneOverrides = {
    volume?: number;
};

type Constructor<T = FilterManager> = abstract new (...args: any[]) => T;

export function VolumeMixin<TBase extends Constructor>(Base: TBase) {
    abstract class VolumeMixin extends Base {
        gainNode?: GainNode;
        _fadeTimeout?: ReturnType<typeof setTimeout>;
        _isFading: boolean = false;

        setGainNode(gainNode: GainNode) {
            this.gainNode = gainNode;
        }

        cleanup(): void {
            this.cancelFade();
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
            this.cancelFade();
            this.gainNode.gain.value = v;
        }

        /**
         * Whether a fade is currently in progress.
         */
        get isFading(): boolean {
            return this._isFading;
        }

        /**
         * Fades the volume to a target value over a duration.
         * @param {number} value - The target volume (0 to 1).
         * @param {number} duration - The fade duration in milliseconds.
         * @param {FadeType} type - The fade curve type, "linear" or "exponential". Defaults to "linear".
         * @returns {Promise<void>} Resolves when the fade completes.
         */
        fadeTo(value: number, duration: number, type: FadeType = "linear"): Promise<void> {
            if (!this.gainNode) {
                throw new Error('Cannot fade a sound that has been cleaned up');
            }
            this.cancelFade();

            const now = this.gainNode.context.currentTime;
            const endTime = now + duration / 1000;

            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);

            if (type === "exponential") {
                this.gainNode.gain.exponentialRampToValueAtTime(
                    value === 0 ? 0.0001 : value,
                    endTime
                );
            } else {
                this.gainNode.gain.linearRampToValueAtTime(value, endTime);
            }

            this._isFading = true;

            return new Promise<void>((resolve) => {
                this._fadeTimeout = setTimeout(() => {
                    this._isFading = false;
                    if (value === 0 && type === "exponential" && this.gainNode) {
                        this.gainNode.gain.value = 0;
                    }
                    resolve();
                }, duration);
            });
        }

        /**
         * Cancels any in-progress fade.
         */
        cancelFade(): void {
            if (this._fadeTimeout) {
                clearTimeout(this._fadeTimeout);
                this._fadeTimeout = undefined;
            }
            if (this._isFading && this.gainNode) {
                const now = this.gainNode.context.currentTime;
                this.gainNode.gain.cancelScheduledValues(now);
                this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            }
            this._isFading = false;
        }

        /**
         * Fades in from silence to the current volume.
         * @param {number} duration - The fade duration in milliseconds.
         * @param {FadeType} type - The fade curve type. Defaults to "linear".
         * @returns {Promise<void>} Resolves when the fade completes.
         */
        fadeIn(duration: number, type?: FadeType): Promise<void> {
            if (!this.gainNode) {
                throw new Error('Cannot fade a sound that has been cleaned up');
            }
            const target = this.gainNode.gain.value;
            this.gainNode.gain.setValueAtTime(0.0001, this.gainNode.context.currentTime);
            return this.fadeTo(target, duration, type);
        }

        /**
         * Fades out from the current volume to silence.
         * @param {number} duration - The fade duration in milliseconds.
         * @param {FadeType} type - The fade curve type. Defaults to "linear".
         * @returns {Promise<void>} Resolves when the fade completes.
         */
        fadeOut(duration: number, type?: FadeType): Promise<void> {
            return this.fadeTo(0, duration, type);
        }

    };

    return VolumeMixin;
}
