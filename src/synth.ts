import { BaseSound, LoopCount, PanType, Position } from "./cacophony";
import { FilterManager } from "./filters";
import { Playback } from "./playback";
import { AudioContext, TOscillatorType, IPannerOptions, PeriodicWave, IPeriodicWave, IAudioScheduledSourceNode, IAudioBufferSourceNode } from "standardized-audio-context";
import { GainNode, BiquadFilterNode } from "./context";

type SynthCloneOverrides = {
    panType?: PanType;
    stereoPan?: number;
    threeDOptions?: Partial<IPannerOptions>;
    loopCount?: LoopCount;
    playbackRate?: number;
    volume?: number;
    position?: Position;
    filters?: BiquadFilterNode[];
    oscillatorType?: OscillatorType;
    frequency?: number;
    periodicWave?: PeriodicWave;
};

export class Synth extends FilterManager implements BaseSound {
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
    private _oscillatorType: OscillatorType = 'sine';
    private _frequency: number = 440;
    private _periodicWave?: IPeriodicWave;
    isPlaying: boolean = false;

    constructor(
        oscillatorType: OscillatorType = 'sine',
        frequency: number = 440,
        context: AudioContext,
        globalGainNode: GainNode,
        public panType: PanType = 'HRTF',
        periodicWave?: IPeriodicWave
    ) {
        super();
        this.context = context;
        this.globalGainNode = globalGainNode;
        this._oscillatorType = oscillatorType;
        this._frequency = frequency;
        if (periodicWave) this._periodicWave = periodicWave;
    }

    clone(overrides: Partial<SynthCloneOverrides> = {}): Synth {
        const panType = overrides.panType || this.panType;
        const stereoPan = overrides.stereoPan !== undefined ? overrides.stereoPan : this.stereoPan;
        const threeDOptions = (overrides.threeDOptions || this.threeDOptions) as IPannerOptions;
        const loopCount = overrides.loopCount !== undefined ? overrides.loopCount : this.loopCount;
        const playbackRate = overrides.playbackRate || this.playbackRate;
        const volume = overrides.volume !== undefined ? overrides.volume : this.volume;
        const position = overrides.position && overrides.position.length ? overrides.position : this.position;
        const filters = overrides.filters && overrides.filters.length ? overrides.filters : this._filters;
        const oscillatorType = overrides.oscillatorType || this._oscillatorType;
        const frequency = overrides.frequency || this._frequency;
        const periodicWave = overrides.periodicWave || this._periodicWave;

        const clone = new Synth(oscillatorType, frequency, this.context, this.globalGainNode, panType, periodicWave);
        clone.loopCount = loopCount;
        clone._playbackRate = playbackRate;
        clone._volume = volume;
        clone._position = position;
        clone._stereoPan = stereoPan as number;
        clone._threeDOptions = threeDOptions;
        clone.addFilters(filters);
        return clone;
    }

    preplay(): Playback[] {
        const oscillator = this.context.createOscillator();
        if (this._periodicWave) {
            oscillator.setPeriodicWave(this._periodicWave);
        } else {
            oscillator.type = this._oscillatorType;
        }
        oscillator.frequency.setValueAtTime(this._frequency, this.context.currentTime);
        
        const gainNode = this.context.createGain();
        gainNode.connect(this.globalGainNode);
        const playback = new Playback(oscillator, gainNode, this.context, this.loopCount, this.panType);
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

    play(): Playback[] {
        const playback = this.preplay();
        playback.forEach(p => p.play());
        this.isPlaying = true;
        return playback;
    }

    stop(): void {
        this.playbacks.forEach(p => p.stop());
        this.playbacks = [];
        this.isPlaying = false;
    }

    pause(): void {
        this.playbacks.forEach(playback => playback.pause());
        this.isPlaying = false;
    }

    seek(time: number): void {
        this.playbacks.forEach(playback => playback.seek(time));
    }

    get duration(): number {
        return Infinity; // Oscillators play indefinitely unless stopped
    }

    get position(): Position {
        return [this._threeDOptions.positionX, this._threeDOptions.positionY, this._threeDOptions.positionZ];
    }

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

    loop(loopCount?: LoopCount): LoopCount {
        if (loopCount === undefined) {
            return this.loopCount;
        }
        this.loopCount = loopCount;
        this.playbacks.forEach(p => p.loop(loopCount));
        return this.loopCount;
    }

    addFilter(filter: BiquadFilterNode): void {
        super.addFilter(filter);
        this.playbacks.forEach(p => p.addFilter(filter));
    }

    removeFilter(filter: BiquadFilterNode): void {
        super.removeFilter(filter);
        this.playbacks.forEach(p => p.removeFilter(filter));
    }

    get volume(): number {
        return this._volume;
    }

    set volume(volume: number) {
        this._volume = volume;
        this.playbacks.forEach(p => p.volume = volume);
    }

    get playbackRate(): number {
        return this._playbackRate;
    }

    set playbackRate(rate: number) {
        this._playbackRate = rate;
        this.playbacks.forEach(p => p.playbackRate = rate);
    }

    get oscillatorType(): OscillatorType {
        return this._oscillatorType;
    }

    set oscillatorType(type: OscillatorType) {
        this._oscillatorType = type;
        this.playbacks.forEach(p => {
            if (p.isOscillator()) {
                p.type = type;
            }
        });
    }

    get frequency(): number {
        return this._frequency;
    }

    set frequency(value: number) {
        this._frequency = value;
        this.playbacks.forEach(p => {
            if (p.isOscillator()) {
                p.frequency = value;
            }
        });
    }

    get periodicWave(): PeriodicWave | undefined {
        return this._periodicWave;
    }

    set periodicWave(wave: IPeriodicWave) {
        this._periodicWave = wave;
        this.playbacks.forEach(p => {
            if (p.isOscillator() && this.periodicWave) {
                p.periodicWave = wave;
            }
        });
    }
}
