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
import { BaseSound, LoopCount, PanType, Position, SoundType } from "./cacophony";
import { BiquadFilterNode, GainNode, SourceNode, } from './context';
import { FilterManager } from "./filters";
import { Playback } from "./playback";
import { AudioContext, IAudioBuffer, IPannerOptions } from "standardized-audio-context";


export class Sound extends FilterManager implements BaseSound {
    buffer?: IAudioBuffer;
    context: AudioContext;
    playbacks: Playback[] = [];
    private globalGainNode: GainNode;
    private _position: Position = [0, 0, 0];
    private _stereoPan: number = 0;
    private _threeDOptions: IPannerOptions = {
        coneInnerAngle: 360,
        coneOuterAngle: 360,
        coneOuterGain: 0,
        distanceModel: 'inverse',
        maxDistance: 10000,
        channelCount: 2,
        channelCountMode: 'clamped-max',
        channelInterpretation: 'speakers',
        panningModel: 'HRTF',
        refDistance: 1,
        rolloffFactor: 1,
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        orientationX: 0,
        orientationY: 0,
        orientationZ: 0
    };
    loopCount: LoopCount = 0;
    private _playbackRate: number = 1;
    private _volume: number = 1;

    constructor(public url: string, buffer: AudioBuffer | undefined, context: AudioContext, globalGainNode: GainNode, public type: SoundType = SoundType.Buffer, public panType: PanType = 'HRTF'
    ) {
        super();
        this.buffer = buffer;
        this.context = context;
        this.globalGainNode = globalGainNode;
    }

    /**
    * Creates a deep copy of the current Sound instance, including all its properties and filters.
    * The cloned sound can be played and manipulated independently of the original.
    * @returns {Sound} A new Sound instance that is a clone of the current sound.
    */

    clone(): Sound {
        const clone = new Sound(this.url, this.buffer, this.context, this.globalGainNode, this.type);
        clone.loopCount = this.loopCount;
        clone._playbackRate = this._playbackRate;
        clone._volume = this._volume;
        clone._position = this._position;
        clone._threeDOptions = this._threeDOptions;
        clone.filters = this.filters;
        clone.panType = this.panType;
        clone._stereoPan = this._stereoPan;
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
        playback.volume = this.volume;
        playback.playbackRate = this.playbackRate;
        this.filters.forEach(filter => playback.addFilter(filter));
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
    }

    /**
    * Pauses all current playbacks of the sound.
    */

    pause(): void {
        this.playbacks.forEach(playback => playback.pause());
    }

    /**
    * Resumes all current playbacks of the sound that were previously paused.
    */

    resume(): void {
        this.playbacks.forEach(playback => playback.resume());
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
    * Retrieves the current 3D spatial position of the sound in the audio context.
    * The position is returned as an array of three values[x, y, z].
    * @returns { Position } The current position of the sound.
    */

    get position(): Position {
        return [this._threeDOptions.positionX, this._threeDOptions.positionY, this._threeDOptions.positionZ]
    }

    /**
    * Sets the 3D spatial position of the sound in the audio context.
    * The position is an array of three values[x, y, z].
    * This method updates the position of all active playbacks of the sound.
    * @param { Position } position - The new position of the sound.
    */

    set position(position: Position) {
        this._threeDOptions.positionX = position[0];
        this._threeDOptions.positionY = position[1];
        this._threeDOptions.positionZ = position[2];
        this.playbacks.forEach(p => p.position = position);
    }


    get threeDOptions(): IPannerOptions {
        return this._threeDOptions;
    }

    set threeDOptions(options: Partial<IPannerOptions>) {
        this._threeDOptions = { ...this._threeDOptions, ...options };
        this.playbacks.forEach(p => p.threeDOptions = this._threeDOptions);
    }

    get stereoPan(): number | null {
        return this._stereoPan;
    }

    set stereoPan(value: number) {
        this._stereoPan = value;
        this.playbacks.forEach(p => p.stereoPan = value);
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

    /**
    * Adds a BiquadFilterNode to the sound's filter chain.
    * Filters are applied in the order they are added.
    * @param { BiquadFilterNode } filter - The filter to add to the chain.
    */

    addFilter(filter: BiquadFilterNode): void {
        super.addFilter(filter);
        this.playbacks.forEach(p => p.addFilter(filter));
    }

    /**
    * Removes a BiquadFilterNode from the sound's filter chain.
    * If the filter is not part of the chain, the method has no effect.
    * @param { BiquadFilterNode } filter - The filter to remove from the chain.
    */

    removeFilter(filter: BiquadFilterNode): void {
        super.removeFilter(filter);
        this.playbacks.forEach(p => p.removeFilter(filter));
    }


    /*** 
        * Gets or sets the volume of the sound. This volume level affects all current and future playbacks of this sound instance.
        * The volume is specified as a linear value between 0 (silent) and 1 (full volume).
        * 
        * @returns {number} The current volume of the sound.
        * @param {number} volume - The new volume level to set, must be between 0 and 1.
        */

    get volume(): number {
        return this._volume;
    }

    set volume(volume: number) {
        this._volume = volume;
        this.playbacks.forEach(p => p.volume = volume);
    }

    /**
    * Returns a boolean indicating whether the sound is currently playing.
    * @returns {boolean} True if the sound is playing, false otherwise.
    */
    isPlaying(): boolean {
        return this.playbacks.some(p => p.isPlaying());
    }

    get playbackRate(): number {
        return this._playbackRate;
    }

    set playbackRate(rate: number) {
        this._playbackRate = rate;
        this.playbacks.forEach(p => p.playbackRate = rate);
    }

}

