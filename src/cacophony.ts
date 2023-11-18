import { AudioContext, IAudioBuffer, IAudioBufferSourceNode, IAudioListener, IBiquadFilterNode, IGainNode, IPannerNode } from 'standardized-audio-context';
import { CacheManager } from './cache';


type GainNode = IGainNode<AudioContext>;
type BiquadFilterNode = IBiquadFilterNode<AudioContext>;

type AudioBufferSourceNode = IAudioBufferSourceNode<AudioContext>;
type PannerNode = IPannerNode<AudioContext>;

type LoopCount = number | 'infinite';

export type FadeType = 'linear' | 'exponential'

export interface BaseSound {
    // the stuff you should be able to do with anything that makes sound including groups, sounds, and playbacks.
    play(): Playback[];
    stop(): void;
    pause(): void;
    resume(): void;
    addFilter(filter: BiquadFilterNode): void;
    removeFilter(filter: BiquadFilterNode): void;
    moveTo(x: number, y: number, z: number): void;
    volume: number;

    loop(loopCount?: LoopCount): LoopCount;
}

export class Cacophony {
    context: AudioContext;
    globalGainNode: GainNode;
    listener: IAudioListener;
    private prevVolume: number = 1;

    constructor(context?: AudioContext) {
        this.context = context || new AudioContext();
        this.listener = this.context.listener;
        this.globalGainNode = this.context.createGain();
        this.globalGainNode.connect(this.context.destination);
    }

    async createSound(buffer: AudioBuffer): Promise<Sound>

    async createSound(url: string): Promise<Sound>

    async createSound(bufferOrUrl: AudioBuffer | string): Promise<Sound> {
        if (bufferOrUrl instanceof AudioBuffer) {
            return Promise.resolve(new Sound(bufferOrUrl, this.context, this.globalGainNode));
        }
        const url = bufferOrUrl;
        return CacheManager.getAudioBuffer(url, this.context).then(buffer => new Sound(buffer, this.context, this.globalGainNode));
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

    createBiquadFilter(type: BiquadFilterType): BiquadFilterNode {
        const filter = this.context.createBiquadFilter();
        filter.type = type;
        return filter;
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

    stopAll() {
        if ('close' in this.context) {
            this.context.close();
        }
    }

    setGlobalVolume(volume: number) {
        this.globalGainNode.gain.value = volume;
    }

    get volume(): number {
        return this.globalGainNode.gain.value;
    }

    set volume(volume: number) {
        this.setGlobalVolume(volume);
    }

    mute() {
        this.prevVolume = this.globalGainNode.gain.value;
        this.setGlobalVolume(0);
    }

    unmute() {
        this.setGlobalVolume(this.prevVolume);
    }

}


class FilterManager {
    protected filters: BiquadFilterNode[] = [];

    addFilter(filter: BiquadFilterNode): void {
        this.filters.push(filter);
    }

    removeFilter(filter: BiquadFilterNode): void {
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
    buffer: IAudioBuffer;
    context: AudioContext;
    playbacks: Playback[] = [];
    globalGainNode: GainNode;
    position: number[] = [0, 0, 0];
    loopCount: LoopCount = 0;

    constructor(buffer: AudioBuffer, context: AudioContext, globalGainNode: IGainNode<AudioContext>) {
        super();
        this.buffer = buffer;
        this.context = context;
        this.globalGainNode = globalGainNode;
    }

    preplay(): Playback[] {
        const source = this.context.createBufferSource();
        source.buffer = this.buffer;
        const gainNode = this.context.createGain();
        source.connect(gainNode);
        gainNode.connect(this.globalGainNode);
        const playback = new Playback(source, gainNode, this.context, this.loopCount);
        this.filters.forEach(filter => playback.addFilter(filter));
        playback.moveTo(this.position[0], this.position[1], this.position[2]);
        this.playbacks.push(playback);
        return [playback];
    }

    play(): Playback[] {
        const playback = this.preplay();
        playback.forEach(p => p.source!.start());
        return playback;
    }

    stop(): void {
        this.playbacks.forEach(p => p.stop());
    }

    pause(): void {
        if ('suspend' in this.context) {
            this.context.suspend();
        }
    }

    resume(): void {
        if ('resume' in this.context) {
            this.context.resume();
        }
    }

    moveTo(x: number, y: number, z: number): void {
        this.position = [x, y, z];
        this.playbacks.forEach(p => p.moveTo(x, y, z));
    }

    loop(loopCount?: LoopCount): LoopCount {
        if (loopCount === undefined) {
            return this.loopCount;
        }
        this.loopCount = loopCount;
        this.playbacks.forEach(p => p.source!.loop = true);
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
        return this.globalGainNode.gain.value;
    }

    set volume(volume: number) {
        this.globalGainNode.gain.value = volume;
        this.playbacks.forEach(p => p.volume = volume);
    }
}

class Playback extends FilterManager implements BaseSound {
    context: AudioContext;
    source?: AudioBufferSourceNode;
    gainNode?: GainNode;
    panner?: PannerNode;
    loopCount: LoopCount = 0;
    currentLoop: number = 0;
    buffer: IAudioBuffer | null = null;

    constructor(source: AudioBufferSourceNode, gainNode: GainNode, context: AudioContext, loopCount: LoopCount = 0) {
        super();
        this.loopCount = loopCount;
        this.source = source;
        this.buffer = source.buffer;
        this.source.onended = this.handleLoop.bind(this);
        this.gainNode = gainNode;
        this.context = context;
        this.panner = context.createPanner();
        source.connect(this.panner).connect(this.gainNode);
        this.refreshFilters();
        source.start();
    }

    handleLoop(): void {
        if (this.loopCount === 'infinite' || this.currentLoop < this.loopCount) {
            this.currentLoop++;
            this.source = this.context.createBufferSource();
            this.source.buffer = this.buffer;
            this.play();
        }
    }

    play() {
        if (!this.source) {
            throw new Error('Cannot play a sound that has been cleaned up');
        }
        this.source.start();
        return [this];
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

    cleanup(): void {
        if (this.source) {
            this.source.disconnect();
            this.source = undefined;
        }
        if (this.gainNode) {
            this.gainNode.disconnect();
            this.gainNode = undefined;
        }
        this.filters.forEach(filter => filter.disconnect());
        this.filters = [];
    }

    loop(loopCount?: LoopCount): LoopCount {
        if (!this.source) {
            throw new Error('Cannot loop a sound that has been cleaned up');
        }
        if (loopCount === undefined) {
            return this.source.loop === true ? 'infinite' : 0;
        }
        this.source.loop = true;
        this.source.loopEnd = this.source.buffer?.duration || 0;
        this.source.loopStart = 0;
        return this.source.loop === true ? 'infinite' : 0;
    }

    stop(): void {
        if (!this.source) {
            throw new Error('Cannot stop a sound that has been cleaned up');
        }
        this.source.stop();
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

    moveTo(x: number, y: number, z: number): void {
        if (!this.panner) {
            throw new Error('Cannot move a sound that has been cleaned up');
        }
        this.panner.positionX.value = x;
        this.panner.positionY.value = y;
        this.panner.positionZ.value = z;
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
}


export class Group implements BaseSound {
    sounds: Sound[] = [];
    position: number[] = [0, 0, 0];
    loopCount: LoopCount = 0;

    addSound(sound: Sound): void {
        this.sounds.push(sound);
    }

    preplay(): Playback[] {
        return this.sounds.reduce<Playback[]>((playbacks, sound) => {
            sound.loop(this.loopCount);
            return playbacks.concat(sound.preplay());
        }, []);
    }

    play(): Playback[] {
        return this.preplay().map(playback => {
            playback.play();
            return playback;
        });
    }

    stop(): void {
        this.sounds.forEach(sound => sound.stop());
    }

    pause(): void {
        this.sounds.forEach(sound => sound.pause());
    }

    resume(): void {
        this.sounds.forEach(sound => {
            if ('resume' in sound.context) {
                sound.context.resume();
            }
        });
    }

    loop(loopCount?: LoopCount): LoopCount {
        if (loopCount === undefined) {
            return this.loopCount;
        }
        this.loopCount = loopCount;
        this.sounds.forEach(sound => sound.loop(loopCount));
        return this.loopCount;
    }

    addFilter(filter: BiquadFilterNode): void {
        this.sounds.forEach(sound => sound.addFilter(filter));
    }

    removeFilter(filter: BiquadFilterNode): void {
        this.sounds.forEach(sound => sound.removeFilter(filter));
    }

    moveTo(x: number, y: number, z: number): void {
        this.position = [x, y, z];
        this.sounds.forEach(sound => sound.moveTo(x, y, z));
    }

    get volume(): number {
        return this.sounds[0].volume;
    }

    set volume(volume: number) {
        this.sounds.forEach(sound => sound.volume = volume);
    }

}

