import { Playback } from "./playback";
import { BiquadFilterNode } from "./context";
import { FilterManager } from "./filters";

type Constructor<T = FilterManager> = abstract new (...args: any[]) => T;

export function PlaybackContainer<TBase extends Constructor>(Base: TBase) {
    abstract class PlaybackMixin extends Base {
        playbacks: Playback[] = [];

        abstract preplay(): Playback[]

        /**
        * Starts playback of the sound and returns a Playback instance representing this particular playback.
        * Multiple Playback instances can be created by calling this method multiple times,
        * allowing for the same sound to be played concurrently with different settings.
        * @returns {Playback[]} An array containing the Playback instances that have been started.
        */

        play(): Playback[] {
            const playback = this.preplay();
            playback.forEach(p => p.play());
            return playback;
        }

        /**
        * Stops all current playbacks of the sound immediately. This will halt the sound regardless of how many times it has been played.
        */

        stop() {
            this.playbacks.forEach(p => p.stop());
            this.playbacks = [];
        }

        /**
        * Pauses all current playbacks of the sound.
        */

        pause(): void {
            this.playbacks.forEach(playback => playback.pause());
        }

        /**
        * Adds a BiquadFilterNode to the container's filter chain.
        * Filters are applied in the order they are added.
        * @param { BiquadFilterNode } filter - The filter to add to the chain.
        */

        addFilter(filter: BiquadFilterNode): void {
            super.addFilter(filter);
            this.playbacks.forEach(p => p.addFilter(filter));
        }


        /**
        * Removes a BiquadFilterNode from the container's filter chain.
        * If the filter is not part of the chain, the method has no effect.
        * @param { BiquadFilterNode } filter - The filter to remove from the chain.
        */

        removeFilter(filter: BiquadFilterNode): void {
            super.removeFilter(filter);
            this.playbacks.forEach(p => p.removeFilter(filter));
        }

        /**
        * Returns a boolean indicating whether the object is currently playing.
        * an object is playing if any of its playbacks are currently playing.
        * @returns {boolean} True if the object is playing, false otherwise.
        */

        get isPlaying(): boolean {
            return this.playbacks.some(p => p.isPlaying);
        }
    };
    return PlaybackMixin;
}