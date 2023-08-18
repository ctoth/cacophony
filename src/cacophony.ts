import { AudioContext, IAudioBuffer, IAudioBufferSourceNode, IAudioListener, IBiquadFilterNode, IGainNode, IPannerNode } from 'standardized-audio-context';
import { CacheManager } from './cache';


type GainNode = IGainNode<AudioContext>;
type BiquadFilterNode = IBiquadFilterNode<AudioContext>;


export interface BaseSound {
    // the stuff you should be able to do with anything that makes sound including groups, sounds, and playbacks.
    play(): Playback[];
    stop(): void;
    pause(): void;
    resume(): void;
    addFilter(filter: BiquadFilterNode): void;
    removeFilter(filter: BiquadFilterNode): void;
    moveTo(x: number, y: number, z: number): void;
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

    getListener(): IAudioListener {
        return this.listener;
    }

    createSound(buffer: AudioBuffer): Sound

    createSound(url: string): Promise<Sound>

    createSound(bufferOrUrl: AudioBuffer | string): Sound | Promise<Sound> {
        if (bufferOrUrl instanceof AudioBuffer) {
            return new Sound(bufferOrUrl, this.context, this.globalGainNode);
        }
        const url = bufferOrUrl;
        return CacheManager.getAudioBuffer(url, this.context).then(buffer => new Sound(buffer, this.context, this.globalGainNode));
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

    mute() {
        this.prevVolume = this.globalGainNode.gain.value;
        this.setGlobalVolume(0);
    }

    unmute() {
        this.setGlobalVolume(this.prevVolume);
    }

}


export class FilterManager {
    protected filters: BiquadFilterNode[] = [];

    addFilter(filter: BiquadFilterNode): void {
        this.filters.push(filter);
    }

    removeFilter(filter: BiquadFilterNode): void {
        this.filters = this.filters.filter(f => f !== filter);
    }

    applyFilters(connection: any): any {
        this.filters.forEach(filter => {
            connection.disconnect();
            connection = connection.connect(filter);
        });
        return connection;
    }
}


class Sound extends FilterManager implements BaseSound {
    buffer: IAudioBuffer;
    context: AudioContext;
    playbacks: Playback[] = [];
    globalGainNode: GainNode;
    position: number[] = [0, 0, 0];

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
        const playback = new Playback(source, gainNode, this.context);
        this.filters.forEach(filter => playback.addFilter(filter));
        playback.moveTo(this.position[0], this.position[1], this.position[2]);
        this.playbacks.push(playback);
        return [playback];
    }

    play(): Playback[] {
        const playback = this.preplay();
        playback.forEach(p => p.source.start());
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

    addFilter(filter: BiquadFilterNode): void {
        super.addFilter(filter);
        this.playbacks.forEach(p => p.addFilter(filter));
    }

    removeFilter(filter: BiquadFilterNode): void {
        super.removeFilter(filter);
        this.playbacks.forEach(p => p.removeFilter(filter));
    }
}


type AudioBufferSourceNode = IAudioBufferSourceNode<AudioContext>;
type PannerNode = IPannerNode<AudioContext>;

class Playback extends FilterManager implements BaseSound {
    context: AudioContext;
    source: AudioBufferSourceNode;
    gainNode: GainNode;
    panner: PannerNode;

    constructor(source: AudioBufferSourceNode, gainNode: GainNode, context: AudioContext) {
        super();
        this.source = source;
        this.gainNode = gainNode;
        this.context = context;
        this.panner = context.createPanner();
        source.connect(this.panner).connect(this.gainNode);
        source.start();
    }

    play() {
        this.source.start();
        return [this];
    }

    set volume(v: number) {
        this.gainNode.gain.value = v;
    }

    fadeIn(time: number): Promise<void> {
        return new Promise(resolve => {
            let volume = 0;
            const increment = this.gainNode.gain.value / (time * 60); // Assuming time is in seconds
            const interval = setInterval(() => {
                volume += increment;
                this.gainNode.gain.value = volume;
                if (volume >= this.gainNode.gain.value) {
                    clearInterval(interval);
                    resolve();
                }
            }, 1000 / 60); // 60 times per second
        });
    }
    fadeOut(time: number): Promise<void> {
        return new Promise(resolve => {
            let volume = this.gainNode.gain.value;
            const decrement = this.gainNode.gain.value / (time * 60);
            const interval = setInterval(() => {
                volume -= decrement;
                this.gainNode.gain.value = volume;
                if (volume <= 0) {
                    clearInterval(interval);
                    resolve();
                }
            }, 1000 / 60);
        });
    }


    stop(): void {
        this.source.stop();
    }

    pause(): void {
        if ('suspend' in this.source.context) {
            this.source.context.suspend();
        }

    }
    resume(): void {
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
        this.panner.positionX.value = x;
        this.panner.positionY.value = y;
        this.panner.positionZ.value = z;
    }

    private refreshFilters(): void {
        let connection = this.source;
        connection = this.applyFilters(connection);
    }
}




class Group implements BaseSound {
    sounds: Sound[] = [];

    addSound(sound: Sound): void {
        this.sounds.push(sound);
    }

    preplay(): Playback[] {
        return this.sounds.reduce<Playback[]>((playbacks, sound) => playbacks.concat(sound.preplay()), []);
    }

    play(): Playback[] {
        return this.sounds.reduce<Playback[]>((playbacks, sound) => playbacks.concat(sound.play()), []);
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

    addFilter(filter: BiquadFilterNode): void {
        this.sounds.forEach(sound => sound.addFilter(filter));
    }

    removeFilter(filter: BiquadFilterNode): void {
        this.sounds.forEach(sound => sound.removeFilter(filter));
    }

    moveTo(x: number, y: number, z: number): void {
        this.sounds.forEach(sound => sound.moveTo(x, y, z));
    }
}
