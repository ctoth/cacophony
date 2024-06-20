/**
 * The Sound class represents an audio asset within a web application, providing a high-level interface
 * for loading, manipulating, and playing audio. It supports both buffer-based and media element-based audio,
 * allowing for efficient playback and manipulation of sound resources.
 *
 * A Sound instance can manage multiple Playback instances, which represent individual playbacks of the sound.
 * This allows for the same sound to be played multiple times simultaneously or with different settings (e.g., volume,
 * playback rate, spatial positioning). The Sound class provides methods to control these playbacks collectively or individually.
 *
 * Key features include:
 * - Loading audio from a URL or using a pre-loaded buffer.
 * - Playing, pausing, resuming, and stopping audio playback.
 * - Looping audio a specific number of times or infinitely.
 * - Adjusting volume, playback rate, and spatial positioning (for 3D audio).
 * - Applying audio filters for effects like reverb, equalization, etc.
 * - Cloning the Sound instance for independent manipulation and playback.
 *
 * The relationship between Sound and Playback is central to the design of the audio system. A Sound object acts as a container
 * and manager for one or more Playback objects. Each Playback object represents a single instance of the sound being played,
 * and can be controlled individually. This architecture allows for complex audio behaviors, such as playing multiple overlapping
 * instances of a sound with different settings, without requiring the user to manually manage each playback instance.
 */


import { PlaybackContainer } from "./container";
import { AudioContext, IAudioBuffer, IPannerOptions } from "standardized-audio-context";
import { BaseSound, LoopCount, PanType, Position, SoundType } from "./cacophony";
import { BiquadFilterNode, GainNode, SourceNode, } from './context';
import { FilterManager } from "./filters";
import { Playback } from "./playback";


type SoundCloneOverrides = {
    panType?: PanType;
    stereoPan?: number;
    threeDOptions?: Partial<IPannerOptions>;
    loopCount?: LoopCount;
    playbackRate?: number;
    volume?: number;
    position?: Position;
    filters?: BiquadFilterNode[];
};


export class Sound extends PlaybackContainer(FilterManager) implements BaseSound {
    buffer?: IAudioBuffer;
    context: AudioContext;
    loopCount: LoopCount = 0;
    private _playbackRate: number = 1;

    constructor(public url: string, buffer: AudioBuffer | undefined, context: AudioContext, private globalGainNode: GainNode, public type: SoundType = SoundType.Buffer, public panType: PanType = 'HRTF'
    ) {
        super();
        this.buffer = buffer;
        this.context = context;
    }

    /**
    * Clones the current Sound instance, creating a deep copy with the option to override specific properties.
    * This method allows for the creation of a new, independent Sound instance based on the current one, with the
    * flexibility to modify certain attributes through the `overrides` parameter. This is particularly useful for
    * creating variations of a sound without affecting the original instance. The cloned instance includes all properties,
    * playback settings, and filters of the original, unless explicitly overridden.
    *
    * @param {SoundCloneOverrides} overrides - An object specifying properties to override in the cloned instance.
    *        This can include audio settings like volume, playback rate, and spatial positioning, as well as
    *        more complex configurations like 3D audio options and filter adjustments.
    * @returns {Sound} A new Sound instance that is a clone of the current sound.
    */

    clone(overrides: Partial<SoundCloneOverrides> = {}): Sound {
        const panType = overrides.panType || this.panType;
        const stereoPan = overrides.stereoPan !== undefined ? overrides.stereoPan : this.stereoPan;
        const threeDOptions = (overrides.threeDOptions || this.threeDOptions) as IPannerOptions;
        const loopCount = overrides.loopCount !== undefined ? overrides.loopCount : this.loopCount;
        const playbackRate = overrides.playbackRate || this.playbackRate;
        const volume = overrides.volume !== undefined ? overrides.volume : this.volume;
        const position = overrides.position && overrides.position.length ? overrides.position : this.position;
        const filters = overrides.filters && overrides.filters.length ? overrides.filters : this._filters;

        const clone = new Sound(this.url, this.buffer, this.context, this.globalGainNode, this.type, panType);
        clone.loopCount = loopCount;
        clone._playbackRate = playbackRate;
        clone._volume = volume;
        clone._position = position;
        clone._stereoPan = stereoPan as number;
        clone._threeDOptions = threeDOptions;
        clone.addFilters(filters);
        return clone;
    }

    /**
    * Generates a Playback instance for the sound without starting playback.
    * This allows for pre-configuration of playback properties such as volume and position before the sound is actually played.
    * @returns {Playback[]} An array of Playback instances that are ready to be played.
    */

    preplay(): Playback[] {
        let source: SourceNode;
        if (this.buffer) {
            source = this.context.createBufferSource();
            source.buffer = this.buffer;
        } else {
            const audio = new Audio();
            audio.crossOrigin = 'anonymous';
            audio.src = this.url;
            audio.preload = "auto"
            // we have the audio, let's make a buffer source node out of it
            source = this.context.createMediaElementSource(audio);
        }
        const gainNode = this.context.createGain();
        gainNode.connect(this.globalGainNode);
        const playback = new Playback(source, gainNode, this.context, this.loopCount, this.panType);
        // this.finalizationRegistry.register(playback, playback);
        playback.setGainNode(gainNode);
        playback.volume = this.volume;
        playback.playbackRate = this.playbackRate;
        this._filters.forEach(filter => playback.addFilter(filter));
        if (this.panType === 'HRTF') {
            playback.threeDOptions = this.threeDOptions;
            playback.position = this.position;
        } else if (this.panType === 'stereo') {
            playback.stereoPan = this.stereoPan as number;
        }
        this.playbacks.push(playback);
        return [playback];
    }

    /**
    * Seeks to a specific time within the sound's playback.
    * @param { number } time - The time in seconds to seek to.
    * This method iterates through all active `Playback` instances and calls their `seek()` method with the specified time.
    */

    seek(time: number): void {
        this.playbacks.forEach(playback => playback.seek(time));
    }

    /**
    * Retrieves the duration of the sound in seconds.
    * If the sound is based on an AudioBuffer, it returns the duration of the buffer.
    * Otherwise, it returns 0, indicating that the duration is unknown or not applicable.
    * @returns { number } The duration of the sound in seconds.
    */

    get duration() {
        return this.buffer?.duration || 0;
    }

    /**
    * Sets or retrieves the loop behavior for the sound.
    * If loopCount is provided, the sound will loop the specified number of times.
    * If loopCount is 'infinite', the sound will loop indefinitely until stopped.
    * If no argument is provided, the method returns the current loop count setting.
    * @param { LoopCount } [loopCount] - The number of times to loop or 'infinite' for indefinite looping.
    * @returns { LoopCount } The current loop count setting if no argument is provided.
    */

    loop(loopCount?: LoopCount): LoopCount {
        if (loopCount === undefined) {
            return this.loopCount;
        }
        this.loopCount = loopCount;
        this.playbacks.forEach(p => p.loop(loopCount));
        return this.loopCount;
    }

    get playbackRate(): number {
        return this._playbackRate;
    }

    set playbackRate(rate: number) {
        this._playbackRate = rate;
        this.playbacks.forEach(p => p.playbackRate = rate);
    }

}

