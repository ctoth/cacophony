import { AudioContext, AudioWorkletNode, IAudioBuffer, IAudioBufferSourceNode, IAudioListener, IBiquadFilterNode, IGainNode, IMediaElementAudioSourceNode, IMediaStreamAudioSourceNode, IPannerNode, IPannerOptions } from 'standardized-audio-context';
import { CacheManager } from './cache';
import { createStream } from './stream';

import phaseVocoderProcessorWorkletUrl from './bundles/phase-vocoder-bundle.js?url';

export enum SoundType {
    HTML = 'HTML',
    Streaming = 'Streaming',
    Buffer = 'Buffer'
}


type GainNode = IGainNode<AudioContext>;
type BiquadFilterNode = IBiquadFilterNode<AudioContext>;

type AudioBufferSourceNode = IAudioBufferSourceNode<AudioContext>;
type MediaElementSourceNode = IMediaElementAudioSourceNode<AudioContext>;

type SourceNode = AudioBufferSourceNode | MediaElementSourceNode;

type PannerNode = IPannerNode<AudioContext>;
type MediaStreamAudioSourceNode = IMediaStreamAudioSourceNode<AudioContext>;


export type Position = [number, number, number];

export type Orientation = {
    forward: Position;
    up: Position;
}


export type LoopCount = number | 'infinite';

export type FadeType = 'linear' | 'exponential'

export interface BaseSound {
    // the stuff you should be able to do with anything that makes sound including groups, sounds, and playbacks.
    isPlaying(): boolean;
    play(): BaseSound[];
    seek?(time: number): void;
    stop(): void;
    pause(): void;
    resume(): void;
    addFilter(filter: BiquadFilterNode): void;
    removeFilter(filter: BiquadFilterNode): void;
    volume: number;
    playbackRate: number;
    position: Position;
    loop?(loopCount?: LoopCount): LoopCount;
    duration: number;
    // Getter and setter for threeDOptions representing PannerNode attributes
    threeDOptions?: IPannerOptions;
}

export class Cacophony {
    context: AudioContext;
    globalGainNode: GainNode;
    listener: IAudioListener;
    private prevVolume: number = 1;
    private finalizationRegistry: FinalizationRegistry<Playback>;

    constructor(context?: AudioContext) {
        this.context = context || new AudioContext();
        this.listener = this.context.listener;
        this.globalGainNode = this.context.createGain();
        this.globalGainNode.connect(this.context.destination);

        this.finalizationRegistry = new FinalizationRegistry((heldValue) => {
            // Cleanup callback for Playbacks
            heldValue.cleanup();
        });
    }

    async loadWorklets() {
        if (this.context.audioWorklet) {
            await this.createWorkletNode('phase-vocoder', phaseVocoderProcessorWorkletUrl);
        }
        else {
            console.warn('AudioWorklet not supported');
        }
    }


    async createWorkletNode(
        name: string,
        url: string
    ) {
        // ensure audioWorklet has been loaded
        if (!this.context.audioWorklet) {
            throw new Error('AudioWorklet not supported');
        }
        try {
            return new AudioWorkletNode!(this.context, name);
        } catch (err) {
            console.error(err)
            console.log("Loading worklet from url", url);
            try {
                await this.context.audioWorklet.addModule(url);
            } catch (err) {
                console.error(err);
                throw new Error(`Could not load worklet from url ${url}`);
            }

            return new AudioWorkletNode!(this.context, name);
        }
    }

    createOscillator = ({ frequency, type, periodicWave }: OscillatorOptions) => {
        const oscillator = this.context.createOscillator();
        oscillator.type = type || 'sine';
        oscillator.setPeriodicWave(periodicWave!);
        oscillator.frequency.value = frequency!;
        oscillator.connect(this.globalGainNode);
        return oscillator
    }

    async createSound(buffer: AudioBuffer, type?: SoundType): Promise<Sound>

    async createSound(url: string, type?: SoundType): Promise<Sound>

    async createSound(bufferOrUrl: AudioBuffer | string, type: SoundType = SoundType.Buffer): Promise<BaseSound> {
        if (bufferOrUrl instanceof AudioBuffer) {
            return Promise.resolve(new Sound("", bufferOrUrl, this.context, this.globalGainNode, SoundType.Buffer));
        }
        const url = bufferOrUrl;
        if (type === SoundType.HTML) {
            const audio = new Audio();
            audio.src = url;
            audio.crossOrigin = 'anonymous';
            return new Sound(url, undefined, this.context, this.globalGainNode, SoundType.HTML);
        }
        return CacheManager.getAudioBuffer(url, this.context).then(buffer => new Sound(url, buffer, this.context, this.globalGainNode, type));
    }

    async createGroup(sounds: Sound[]): Promise<Group> {
        const group = new Group();
        sounds.forEach(sound => group.addSound(sound));
        return group;
    }

    async createGroupFromUrls(urls: string[]): Promise<Group> {
        const group = new Group();
        const sounds = await Promise.all(urls.map(url => this.createSound(url)));
        sounds.forEach(sound => group.addSound(sound));
        return group;
    }

    async createStream(url: string): Promise<Sound> {
        const stream = await createStream(url, this.context);
        const sound = new Sound(url, undefined, this.context, this.globalGainNode, SoundType.Streaming);
        return sound;
    }

    createBiquadFilter({ type, frequency, gain, Q }: BiquadFilterOptions): BiquadFilterNode {
        const filter = this.context.createBiquadFilter();
        filter.type = type || 'lowpass';
        filter.frequency.value = frequency || 350;
        filter.gain.value = gain || 0;
        filter.Q.value = Q || 1;
        return filter;
    }

    createPanner({ coneInnerAngle, coneOuterAngle, coneOuterGain, distanceModel, maxDistance, channelCount, channelCountMode, channelInterpretation, panningModel, refDistance, rolloffFactor, positionX, positionY, positionZ, orientationX, orientationY, orientationZ }: Partial<IPannerOptions>): PannerNode {
        const panner = this.context.createPanner();
        panner.coneInnerAngle = coneInnerAngle || 360;
        panner.coneOuterAngle = coneOuterAngle || 360;
        panner.coneOuterGain = coneOuterGain || 0;
        panner.distanceModel = distanceModel || 'inverse';
        panner.maxDistance = maxDistance || 10000;
        panner.channelCount = channelCount || 2;
        panner.channelCountMode = channelCountMode || 'clamped-max';
        panner.channelInterpretation = channelInterpretation || 'speakers';
        panner.panningModel = panningModel || 'HRTF';
        panner.refDistance = refDistance || 1;
        panner.rolloffFactor = rolloffFactor || 1;
        panner.positionX.value = positionX || 0;
        panner.positionY.value = positionY || 0;
        panner.positionZ.value = positionZ || 0;
        panner.orientationX.value = orientationX || 0;
        panner.orientationY.value = orientationY || 0;
        panner.orientationZ.value = orientationZ || 0;
        return panner;
    }

    pause() {
        if ('suspend' in this.context) {
            this.context.suspend();
        }
    }

    resume() {
        if ('resume' in this.context) {
            this.context.resume();
        }
    }

    setGlobalVolume(volume: number) {
        this.globalGainNode.gain.value = volume;
    }

    get volume(): number {
        return this.globalGainNode.gain.value;
    }

    set volume(volume: number) {
        if (this.muted) {
            this.prevVolume = volume;
            return;
        }
        this.setGlobalVolume(volume);
    }

    mute() {
        if (!this.muted) {
            this.prevVolume = this.globalGainNode.gain.value;
            this.setGlobalVolume(0);
        }
    }

    unmute() {
        if (this.muted) {
            this.setGlobalVolume(this.prevVolume);
        }
    }

    get muted(): boolean {
        return this.globalGainNode.gain.value === 0;
    }

    set muted(muted: boolean) {
        if (muted !== this.muted) {
            if (muted) {
                this.mute();
            } else {
                this.unmute();
            }
        }
    }

    getMicrophoneStream(): Promise<MicrophoneStream> {
        return new Promise((resolve, reject) => {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    const microphoneStream = new MicrophoneStream(this.context);
                    microphoneStream.play();
                    resolve(microphoneStream);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }

    get listenerOrientation(): Orientation {
        return {
            forward: [this.listener.forwardX.value, this.listener.forwardY.value, this.listener.forwardZ.value],
            up: [this.listener.upX.value, this.listener.upY.value, this.listener.upZ.value]
        };
    }

    set listenerOrientation(orientation: Orientation) {
        const { forward, up } = orientation;
        const [forwardX, forwardY, forwardZ] = forward;
        const [upX, upY, upZ] = up;
        this.listener.forwardX.setValueAtTime(forwardX, this.context.currentTime);
        this.listener.forwardY.setValueAtTime(forwardY, this.context.currentTime);
        this.listener.forwardZ.setValueAtTime(forwardZ, this.context.currentTime);
        this.listener.upX.setValueAtTime(upX, this.context.currentTime);
        this.listener.upY.setValueAtTime(upY, this.context.currentTime);
        this.listener.upZ.setValueAtTime(upZ, this.context.currentTime);
    }

    get listenerUpOrientation(): Position {
        return [this.listener.upX.value, this.listener.upY.value, this.listener.upZ.value];
    }

    set listenerUpOrientation(up: Position) {
        const [x, y, z] = up;
        this.listener.upX.setValueAtTime(x, this.context.currentTime);
        this.listener.upY.setValueAtTime(y, this.context.currentTime);
        this.listener.upZ.setValueAtTime(z, this.context.currentTime);
    }

    get listenerForwardOrientation(): Position {
        return [this.listener.forwardX.value, this.listener.forwardY.value, this.listener.forwardZ.value];
    }

    set listenerForwardOrientation(forward: Position) {
        const [x, y, z] = forward;
        this.listener.forwardX.setValueAtTime(x, this.context.currentTime);
        this.listener.forwardY.setValueAtTime(y, this.context.currentTime);
        this.listener.forwardZ.setValueAtTime(z, this.context.currentTime);
    }

    get listenerPosition(): Position {
        return [this.listener.positionX.value, this.listener.positionY.value, this.listener.positionZ.value];
    }

    set listenerPosition(position: Position) {
        const [x, y, z] = position;
        this.listener.positionX.setValueAtTime(x, this.context.currentTime);
        this.listener.positionY.setValueAtTime(y, this.context.currentTime);
        this.listener.positionZ.setValueAtTime(z, this.context.currentTime);
    }

}


abstract class FilterManager {
    protected filters: BiquadFilterNode[] = [];

    addFilter(filter: BiquadFilterNode) {
        this.filters.push(filter);
    }

    removeFilter(filter: BiquadFilterNode) {
        this.filters = this.filters.filter(f => f !== filter);
    }

    applyFilters(connection: any): any {
        this.filters.reduce((prevConnection, filter) => {
            prevConnection.connect(filter);
            return filter;
        }, connection);
        return this.filters.length > 0 ? this.filters[this.filters.length - 1] : connection;
    }
}


export class Sound extends FilterManager implements BaseSound {
    buffer?: IAudioBuffer;
    context: AudioContext;
    playbacks: Playback[] = [];
    private globalGainNode: GainNode;
    private _position: Position = [0, 0, 0];
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

    constructor(public url: string, buffer: AudioBuffer | undefined, context: AudioContext, globalGainNode: GainNode, public type: SoundType = SoundType.Buffer) {
        super();
        this.buffer = buffer;
        this.context = context;
        this.globalGainNode = globalGainNode;
        this._position = [0, 0, 0];
    }

    clone(): Sound {
        const clone = new Sound(this.url, this.buffer, this.context, this.globalGainNode, this.type);
        clone.loopCount = this.loopCount;
        clone._playbackRate = this._playbackRate;
        clone._volume = this._volume;
        clone._position = this._position;
        clone._threeDOptions = this._threeDOptions;
        clone.filters = this.filters;
        return clone;
    }

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
        const playback = new Playback(source, gainNode, this.context, this.loopCount);
        // this.finalizationRegistry.register(playback, playback);
        playback.volume = this.volume;
        playback.playbackRate = this.playbackRate;
        this.filters.forEach(filter => playback.addFilter(filter));
        playback.threeDOptions = this.threeDOptions;
        playback.position = this.position;
        this.playbacks.push(playback);
        return [playback];
    }

    play(): Playback[] {
        const playback = this.preplay();
        playback.forEach(p => p.play());
        return playback;
    }

    stop() {
        this.playbacks.forEach(p => p.stop());
    }

    pause() {
        if ('suspend' in this.context) {
            this.context.suspend();
        }
    }

    resume(): void {
        if ('resume' in this.context) {
            this.context.resume();
        }
    }

    seek(time: number): void {
        this.playbacks.forEach(playback => playback.seek(time));
    }

    get duration() {
        return this.buffer?.duration || 0;
    }

    set position(position: Position) {
        this._threeDOptions.positionX = position[0];
        this._threeDOptions.positionY = position[1];
        this._threeDOptions.positionZ = position[2];
        this.playbacks.forEach(p => p.position = position);
    }

    get position(): Position {
        return [this._threeDOptions.positionX, this._threeDOptions.positionY, this._threeDOptions.positionZ]
    }

    get threeDOptions(): IPannerOptions {
        return this._threeDOptions;
    }

    set threeDOptions(options: Partial<IPannerOptions>) {
        this._threeDOptions = { ...this._threeDOptions, ...options };
        this.playbacks.forEach(p => p.threeDOptions = this._threeDOptions);
    }

    loop(loopCount?: LoopCount): LoopCount {
        if (loopCount === undefined) {
            return this.loopCount;
        }
        this.loopCount = loopCount;
        this.playbacks.forEach(p => p.sourceLoop = true);
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

export class Playback extends FilterManager implements BaseSound {
    private context: AudioContext;
    private source?: SourceNode;
    private gainNode?: GainNode;
    private panner?: PannerNode;
    loopCount: LoopCount = 0;
    currentLoop: number = 0;
    private buffer?: IAudioBuffer;
    private playing: boolean = false;

    constructor(source: SourceNode, gainNode: GainNode, context: AudioContext, loopCount: LoopCount = 0) {
        super();
        this.loopCount = loopCount;
        this.source = source;
        if ('buffer' in source && source.buffer) {
            this.buffer = source.buffer;
        }
        if ('mediaElement' in source && source.mediaElement) {
            source.mediaElement.onended = this.handleLoop.bind(this);
        } else if ('onended' in source) {
            source.onended = this.handleLoop.bind(this);
        }
        this.gainNode = gainNode;
        this.context = context;
        this.panner = context.createPanner();
        source.connect(this.panner);
        this.panner.connect(this.gainNode);
        this.refreshFilters();
    }

    get duration() {
        if (!this.buffer) {
            throw new Error('Cannot get duration of a sound that has been cleaned up');
        }
        return this.buffer.duration;
    }

    get playbackRate() {
        if (!this.source) {
            throw new Error('Cannot get playback rate of a sound that has been cleaned up');
        }
        if ('playbackRate' in this.source) {
            return this.source.playbackRate.value;
        }
        if ('mediaElement' in this.source && this.source.mediaElement) {
            return this.source.mediaElement.playbackRate;
        }
        throw new Error('Unsupported source type');
    }
    set playbackRate(rate: number) {
        if (!this.source) {
            throw new Error('Cannot set playback rate of a sound that has been cleaned up');
        }
        if ('playbackRate' in this.source) {
            this.source.playbackRate.value = rate;
        }
        if ('mediaElement' in this.source && this.source.mediaElement) {
            this.source.mediaElement.playbackRate = rate;
        }
    }

    handleLoop() {
        if (this.buffer) {
            this.source = this.context.createBufferSource();
            this.source.buffer = this.buffer;
        } else {
            this.seek(0);
        }
        if (this.loopCount === 'infinite' || this.currentLoop < this.loopCount) {
            this.currentLoop++;
            if (this.playing) {
                this.play();
            }
        } else {
            this.playing = false;
        }
    }


    play(): [this] {
        if (!this.source) {
            throw new Error('Cannot play a sound that has been cleaned up');
        }
        if ('mediaElement' in this.source && this.source.mediaElement) {
            this.source.mediaElement.play();
        } else if ('start' in this.source && this.source.start) {
            this.source.start();
        }
        this.playing = true;
        return [this];
    }

    get threeDOptions(): IPannerOptions {
        if (!this.panner) {
            throw new Error('Cannot get 3D options of a sound that has been cleaned up');
        }
        return {
            coneInnerAngle: this.panner.coneInnerAngle,
            coneOuterAngle: this.panner.coneOuterAngle,
            coneOuterGain: this.panner.coneOuterGain,
            distanceModel: this.panner.distanceModel,
            maxDistance: this.panner.maxDistance,
            channelCount: this.panner.channelCount,
            channelCountMode: this.panner.channelCountMode,
            channelInterpretation: this.panner.channelInterpretation,
            panningModel: this.panner.panningModel,
            refDistance: this.panner.refDistance,
            rolloffFactor: this.panner.rolloffFactor,
            positionX: this.panner.positionX.value,
            positionY: this.panner.positionY.value,
            positionZ: this.panner.positionZ.value,
            orientationX: this.panner.orientationX.value,
            orientationY: this.panner.orientationY.value,
            orientationZ: this.panner.orientationZ.value
        }
    }

    set threeDOptions(options: Partial<IPannerOptions>) {
        if (!this.panner) {
            throw new Error('Cannot set 3D options of a sound that has been cleaned up');
        }
        this.panner.coneInnerAngle = options.coneInnerAngle || this.panner.coneInnerAngle;
        this.panner.coneOuterAngle = options.coneOuterAngle || this.panner.coneOuterAngle;
        this.panner.coneOuterGain = options.coneOuterGain || this.panner.coneOuterGain;
        this.panner.distanceModel = options.distanceModel || this.panner.distanceModel;
        this.panner.maxDistance = options.maxDistance || this.panner.maxDistance;
        this.panner.channelCount = options.channelCount || this.panner.channelCount;
        this.panner.channelCountMode = options.channelCountMode || this.panner.channelCountMode;
        this.panner.channelInterpretation = options.channelInterpretation || this.panner.channelInterpretation;
        this.panner.panningModel = options.panningModel || this.panner.panningModel;
        this.panner.refDistance = options.refDistance || this.panner.refDistance;
        this.panner.rolloffFactor = options.rolloffFactor || this.panner.rolloffFactor;
        this.panner.positionX.value = options.positionX || this.panner.positionX.value;
        this.panner.positionY.value = options.positionY || this.panner.positionY.value;
        this.panner.positionZ.value = options.positionZ || this.panner.positionZ.value;
        this.panner.orientationX.value = options.orientationX || this.panner.orientationX.value;
        this.panner.orientationY.value = options.orientationY || this.panner.orientationY.value;
        this.panner.orientationZ.value = options.orientationZ || this.panner.orientationZ.value;
    }

    seek(time: number): void {
        if (!this.source || !this.buffer || !this.gainNode || !this.panner) {
            throw new Error('Cannot seek a sound that has been cleaned up');
        }
        const playing = this.isPlaying();
        // Stop the current playback
        this.stop();        // Create a new source to start from the desired time
        this.source = this.context.createBufferSource();
        this.source.buffer = this.buffer;
        this.refreshFilters();
        this.source.connect(this.panner).connect(this.gainNode);
        if (playing) {
            this.source.start(0, time);
        }
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

    set sourceLoop(loop: boolean) {
        if (!this.source) {
            throw new Error('Cannot set loop on a sound that has been cleaned up');
        }
        if ('loop' in this.source) {
            this.source.loop = loop;
        }
        if ("mediaElement" in this.source && this.source.mediaElement) {
            this.source.mediaElement.loop = loop;
        }
    }

    fadeIn(time: number, fadeType: FadeType = 'linear'): Promise<void> {
        return new Promise(resolve => {
            if (!this.gainNode) {
                throw new Error('Cannot fade in a sound that has been cleaned up');
            }

            const initialVolume = this.gainNode.gain.value;
            const targetVolume = 1; // Assuming the target volume after fade-in is 1 (full volume)

            // Reset volume to 0 to start the fade-in process
            this.gainNode.gain.value = 0;

            switch (fadeType) {
                case 'exponential':
                    // Start at a low value (0.01) because exponentialRampToValueAtTime cannot ramp from 0
                    this.gainNode.gain.setValueAtTime(0.01, this.context.currentTime);
                    this.gainNode.gain.exponentialRampToValueAtTime(targetVolume, this.context.currentTime + time);
                    break;
                case 'linear':
                    this.gainNode.gain.linearRampToValueAtTime(targetVolume, this.context.currentTime + time);
                    break;
            }

            // Resolve the Promise after the fade-in time
            setTimeout(() => {
                // Ensure the final volume is set to the target volume
                if (!this.gainNode) {
                    throw new Error('Cannot fade in a sound that has been cleaned up');
                }
                this.gainNode.gain.value = targetVolume;
                resolve();
            }, time * 1000);
        });
    }

    fadeOut(time: number, fadeType: FadeType = 'linear'): Promise<void> {
        return new Promise(resolve => {
            // Storing the current gain value
            if (!this.gainNode) {
                throw new Error('Cannot fade out a sound that has been cleaned up');
            }
            const initialVolume = this.gainNode.gain.value;
            switch (fadeType) {
                case 'exponential':
                    // Scheduling an exponential fade down
                    this.gainNode.gain.exponentialRampToValueAtTime(0.01, this.context.currentTime + time);
                    break;
                case 'linear':

                    // Scheduling a linear ramp to 0 over the given duration
                    this.gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + time);
            }
            // Resolving the Promise after the fade-out time
            setTimeout(() => resolve(), time * 1000);
        });
    }

    isPlaying(): boolean {
        if (!this.source) {
            throw new Error('Cannot check if a sound is playing that has been cleaned up');
        }
        return this.playing;
    }

    cleanup(): void {
        // Ensure cleanup is idempotent
        if (this.source) {
            this.source.disconnect();
            this.source = undefined;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = undefined;
        }
        this.filters.forEach(filter => {
            if (filter) {
                filter.disconnect();
            }
        });
        this.filters = [];
        // Additional cleanup logic if needed
    }

    loop(loopCount?: LoopCount): LoopCount {
        if (!this.source) {
            throw new Error('Cannot loop a sound that has been cleaned up');
        }

        // Check if the source is an AudioBufferSourceNode
        if (this.source instanceof AudioBufferSourceNode) {
            if (loopCount === undefined) {
                return this.source.loop === true ? 'infinite' : 0;
            }
            this.source.loop = true;
            this.source.loopEnd = this.source.buffer?.duration || 0;
            this.source.loopStart = 0;
            return this.source.loop === true ? 'infinite' : 0;
        }

        // Check if the source is a MediaElementSourceNode
        if ("mediaElement" in this.source && this.source.mediaElement) {
            const mediaElement = this.source.mediaElement;
            if (loopCount === undefined) {
                return mediaElement.loop === true ? 'infinite' : 0;
            }
            mediaElement.loop = true;
            // Looping for HTMLMediaElement is controlled by the 'loop' attribute, no need for loopStart or loopEnd
            return mediaElement.loop === true ? 'infinite' : 0;
        }

        throw new Error('Unsupported source type');
    }

    stop(): void {
        if (!this.source) {
            throw new Error('Cannot stop a sound that has been cleaned up');
        }
        if (!this.isPlaying()) {
            return;
        }
        if ('stop' in this.source) {
            this.source.stop();
        }
        if ("mediaElement" in this.source && this.source.mediaElement) {
            this.source.mediaElement.pause();
            this.source.mediaElement.currentTime = 0;
        }
        this.playing = false;
    }

    pause(): void {
        if (!this.source) {
            throw new Error('Cannot pause a sound that has been cleaned up');
        }
        if ('suspend' in this.source.context) {
            this.source.context.suspend();
        }
    }

    resume(): void {
        if (!this.source) {
            throw new Error('Cannot resume a sound that has been cleaned up');
        }
        if ('resume' in this.source.context) {
            this.source.context.resume();
        }
    }

    addFilter(filter: BiquadFilterNode): void {
        super.addFilter(filter);
        this.refreshFilters();
    }

    removeFilter(filter: BiquadFilterNode): void {
        super.removeFilter(filter);
        this.refreshFilters();
    }

    set position(position: Position) {
        if (!this.panner) {
            throw new Error('Cannot move a sound that has been cleaned up');
        }
        const [x, y, z] = position;
        this.panner.positionX.setValueAtTime(x, this.context.currentTime);
        this.panner.positionY.setValueAtTime(y, this.context.currentTime);
        this.panner.positionZ.setValueAtTime(z, this.context.currentTime);
    }

    get position(): Position {
        if (!this.panner) {
            throw new Error('Cannot get position of a sound that has been cleaned up');
        }
        return [this.panner.positionX.value, this.panner.positionY.value, this.panner.positionZ.value];
    }

    private refreshFilters(): void {
        if (!this.panner || !this.gainNode) {
            throw new Error('Cannot update filters on a sound that has been cleaned up');
        }
        let connection = this.panner;
        connection.disconnect();
        connection = this.applyFilters(connection);
        connection.connect(this.gainNode);
    }
}


export class Group implements BaseSound {
    sounds: BaseSound[] = [];
    private _position: Position = [0, 0, 0];
    loopCount: LoopCount = 0;

    get duration() {
        return this.sounds.map(sound => sound.duration).reduce((a, b) => Math.max(a, b), 0);
    }

    seek(time: number): void {
        this.sounds.forEach(sound => sound.seek && sound.seek(time));
    }

    addSound(sound: BaseSound): void {
        this.sounds.push(sound);
    }

    preplay(): Playback[] {
        return (this.sounds as Sound[]).reduce<Playback[]>((playbacks, sound) => {
            sound.loop && sound.loop(this.loopCount);
            return playbacks.concat(sound.preplay());
        }, []);
    }

    play(): Playback[] {
        return this.preplay().map(playback => {
            playback.play();
            return playback;
        });
    }

    isPlaying(): boolean {
        return this.sounds.some(sound => sound.isPlaying());
    }

    stop(): void {
        this.sounds.forEach(sound => sound.stop());
    }

    pause(): void {
        this.sounds.forEach(sound => sound.pause());
    }

    resume(): void {
        this.sounds.forEach(sound => sound.resume());
    }

    loop(loopCount?: LoopCount): LoopCount {
        if (loopCount === undefined) {
            return this.loopCount;
        }
        this.loopCount = loopCount;
        this.sounds.forEach(sound => sound.loop && sound.loop(loopCount));
        return this.loopCount;
    }

    addFilter(filter: BiquadFilterNode): void {
        this.sounds.forEach(sound => sound.addFilter(filter));
    }

    removeFilter(filter: BiquadFilterNode): void {
        this.sounds.forEach(sound => sound.removeFilter(filter));
    }

    set position(position: [number, number, number]) {
        this._position = position;
        this.sounds.forEach(sound => sound.position = this._position);
    }

    get position(): [number, number, number] {
        return this._position;
    }

    get volume(): number {
        return this.sounds.map(sound => sound.volume).reduce((a, b) => a + b, 0) / this.sounds.length;
    }

    set volume(volume: number) {
        this.sounds.forEach(sound => sound.volume = volume);
    }

    get playbackRate(): number {
        if (this.sounds.length === 0) {
            return 1;
        }
        return this.sounds[0].playbackRate
    }

    set playbackRate(rate: number) {
        this.sounds.forEach(sound => sound.playbackRate = rate);
    }


}

export class MicrophonePlayback extends FilterManager {
    private context: AudioContext;
    private source?: MediaStreamAudioSourceNode;
    private gainNode?: GainNode;
    private panner?: PannerNode;


    constructor(source: MediaStreamAudioSourceNode, gainNode: GainNode, context: AudioContext, loopCount: LoopCount = 0) {
        super();
        this.source = source;
        this.gainNode = gainNode;
        this.context = context;
        this.panner = context.createPanner();
        source.connect(this.panner).connect(this.gainNode);
        this.refreshFilters();
    }

    get duration() {
        return 0;
    }

    play() {
        if (!this.source) {
            throw new Error('Cannot play a sound that has been cleaned up');
        }
        return [this];
    }

    isPlaying() {
        return Boolean(this.source);
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

    stop(): void {
        if (!this.source) {
            throw new Error('Cannot stop a sound that has been cleaned up');
        }
        this.source.mediaStream.getTracks().forEach(track => track.stop());
    }

    pause(): void {
        if (!this.source) {
            throw new Error('Cannot pause a sound that has been cleaned up');
        }
        this.source.mediaStream.getTracks().forEach(track => track.enabled = false);
    }

    resume(): void {
        if (!this.source) {
            throw new Error('Cannot resume a sound that has been cleaned up');
        }
        this.source.mediaStream.getTracks().forEach(track => track.enabled = true);
    }

    addFilter(filter: BiquadFilterNode): void {
        super.addFilter(filter);
        this.refreshFilters();
    }

    removeFilter(filter: BiquadFilterNode): void {
        super.removeFilter(filter);
        this.refreshFilters();
    }

    set position(position: Position) {
        if (!this.panner) {
            throw new Error('Cannot move a sound that has been cleaned up');
        }
        const [x, y, z] = position;
        this.panner.positionX.value = x;
        this.panner.positionY.value = y;
        this.panner.positionZ.value = z;
    }

    get position(): Position {
        if (!this.panner) {
            throw new Error('Cannot get position of a sound that has been cleaned up');
        }
        return [this.panner.positionX.value, this.panner.positionY.value, this.panner.positionZ.value];
    }

    private refreshFilters(): void {
        if (!this.source || !this.gainNode) {
            throw new Error('Cannot update filters on a sound that has been cleaned up');
        }
        let connection = this.source;
        this.source.disconnect();
        connection = this.applyFilters(connection);
        connection.connect(this.gainNode);
    }

    get playbackRate(): number {
        // Playback rate is not applicable for live microphone stream
        return 1;
    }

    set playbackRate(rate: number) {
    }



}

export class MicrophoneStream extends FilterManager implements BaseSound {
    context: AudioContext;
    private _position: Position = [0, 0, 0];
    loopCount: LoopCount = 0;
    private prevVolume: number = 1;
    private microphoneGainNode: GainNode;
    private streamPlayback?: MicrophonePlayback;
    private stream: MediaStream | undefined;
    private streamSource?: MediaStreamAudioSourceNode;

    constructor(context: AudioContext) {
        super();
        this.context = context;
        this.microphoneGainNode = this.context.createGain();
    }

    play(): MicrophonePlayback[] {
        if (!this.stream) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    this.stream = stream;
                    this.streamSource = this.context.createMediaStreamSource(this.stream);
                    this.streamPlayback = new MicrophonePlayback(this.streamSource, this.microphoneGainNode, this.context);
                    this.streamPlayback.play();
                })
                .catch(err => {
                    console.error('Error initializing microphone stream:', err);
                });
        }
        return this.streamPlayback ? [this.streamPlayback] : [];
    }

    get duration() {
        return 0;
    }


    seek(time: number) {
        // Seeking is not applicable for live microphone stream
    }

    isPlaying(): boolean {
        return Boolean(this.streamPlayback);
    }

    stop() {
        if (this.streamPlayback) {
            this.streamPlayback.stop();
            this.streamPlayback = undefined;
        }
    }

    pause() {
        if (this.streamPlayback) {
            this.streamPlayback.pause();
        }
    }

    resume() {
        if (this.streamPlayback) {
            this.streamPlayback.resume();
        }
    }

    addFilter(filter: BiquadFilterNode): void {
        if (this.streamPlayback) {
            this.streamPlayback.addFilter(filter);
        }
    }

    removeFilter(filter: BiquadFilterNode): void {
        if (this.streamPlayback) {
            this.streamPlayback.removeFilter(filter);
        }
    }

    get volume(): number {
        return this.streamPlayback ? this.streamPlayback.volume : 0;
    }

    set volume(volume: number) {
        if (this.streamPlayback) {
            this.streamPlayback.volume = volume;
        }
    }

    get position(): Position {
        // Position is not applicable for live microphone stream
        return [0, 0, 0];
    }

    set position(position: Position) {
        // Position is not applicable for live microphone stream
    }

    loop(loopCount?: LoopCount): LoopCount {
        // Looping is not applicable for live microphone stream
        return 0;
    }


    get playbackRate(): number {
        // Playback rate is not applicable for live microphone stream
        return 1;
    }

    set playbackRate(rate: number) {
    }

}
