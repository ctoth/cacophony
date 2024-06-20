import { AudioContext, IOscillatorOptions, IPannerOptions } from "standardized-audio-context";
import { BaseSound, LoopCount, PanType, Position, SoundType } from "./cacophony";
import { PlaybackContainer } from "./container";
import { BiquadFilterNode, GainNode } from './context';
import { FilterManager } from "./filters";
import { Playback } from "./playback";
import { SynthPlayback } from "./synthPlayback";

type SynthCloneOverrides = {
    panType?: PanType;
    stereoPan?: number;
    threeDOptions?: Partial<IPannerOptions>;
    loopCount?: LoopCount;
    playbackRate?: number;
    volume?: number;
    position?: Position;
    filters?: BiquadFilterNode[];
    oscillatorOptions?: Partial<IOscillatorOptions>;
};

export class Synth extends PlaybackContainer(FilterManager) implements BaseSound {
    loopCount: LoopCount = 0;
    private _playbackRate: number = 1;
    private _oscillatorOptions: Partial<IOscillatorOptions>;
    protected playbacks: SynthPlayback[] = [];

    constructor(
        public context: AudioContext,
        private globalGainNode: GainNode,
        public type: SoundType = SoundType.Oscillator,
        public panType: PanType = 'HRTF',
        oscillatorOptions: Partial<IOscillatorOptions> = {}
    ) {
        super();
        this.context = context;
        this._oscillatorOptions = oscillatorOptions;
    }
    duration: number = 0;

    /**
     * Clones the current Synth instance, creating a deep copy with the option to override specific properties.
     * This method allows for the creation of a new, independent Sound instance based on the current one, with the
     * flexibility to modify certain attributes through the `overrides` parameter. This is particularly useful for
     * creating variations of a sound without affecting the original instance. The cloned instance includes all properties,
     * playback settings, and filters of the original, unless explicitly overridden.
     *
     * @param {SynthCloneOverrides} overrides - An object specifying properties to override in the cloned instance.
     *        This can include audio settings like volume, playback rate, and spatial positioning, as well as
     *        more complex configurations like 3D audio options and filter adjustments.
     * @returns {Sound} A new Sound instance that is a clone of the current sound.
     */
    clone(overrides: Partial<SynthCloneOverrides> = {}): Synth {
        const panType = overrides.panType || this.panType;
        const stereoPan = overrides.stereoPan !== undefined ? overrides.stereoPan : this.stereoPan;
        const threeDOptions = (overrides.threeDOptions || this.threeDOptions) as IPannerOptions;
        const loopCount = overrides.loopCount !== undefined ? overrides.loopCount : this.loopCount;
        const playbackRate = overrides.playbackRate || this.playbackRate;
        const volume = overrides.volume !== undefined ? overrides.volume : this.volume;
        const position = overrides.position && overrides.position.length ? overrides.position : this.position;
        const filters = overrides.filters && overrides.filters.length ? overrides.filters : this._filters;
        const oscillatorOptions = overrides.oscillatorOptions || this._oscillatorOptions;

        const clone = new Synth(this.context, this.globalGainNode, this.type, panType, oscillatorOptions);
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
        const oscillator = this.context.createOscillator();
        Object.assign(oscillator, this._oscillatorOptions);

        const gainNode = this.context.createGain();
        gainNode.connect(this.globalGainNode);
        const playback = new SynthPlayback(oscillator, gainNode, this.context, this.loopCount, this.panType);
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

    get oscillatorOptions(): Partial<IOscillatorOptions> {
        return this._oscillatorOptions;
    }

    set oscillatorOptions(options: Partial<IOscillatorOptions>) {
        this._oscillatorOptions = options;
        this.playbacks.forEach(p => {
            if (p.source instanceof OscillatorNode) {
                Object.assign(p.source, options);
            }
        });
    }
}
