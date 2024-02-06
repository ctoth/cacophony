import { BaseSound, LoopCount, Position } from './cacophony';

import { BiquadFilterNode } from './context';
import { Playback } from './playback';
import { Sound } from './sound';


export class Group implements BaseSound {
    sounds: Sound[] = [];
    private _position: Position = [0, 0, 0];
    loopCount: LoopCount = 0;
    private playIndex: number = 0;

    playRandom(): Playback {
        if (this.sounds.length === 0) {
            throw new Error('Cannot play a random sound from an empty group');
        }
        const randomIndex = Math.floor(Math.random() * this.sounds.length);
        const randomSound = this.sounds[randomIndex] as Sound;
        const playback = randomSound.preplay();
        playback.forEach(p => p.play());
        return playback[0];
    }

    playOrdered(shouldLoop: boolean = true): Playback {
        if (this.sounds.length === 0) {
            throw new Error('Cannot play an ordered sound from an empty group');
        }
        const sound = this.sounds[this.playIndex] as Sound;
        const playback = sound.preplay();
        playback.forEach(p => p.play());
        this.playIndex++;
        if (this.playIndex >= this.sounds.length) {
            if (shouldLoop) {
                this.playIndex = 0;
            } else {
                this.playIndex = this.sounds.length; // Set to length to indicate end of list
            }
        }
        return playback[0];
    }

    get duration() {
        return this.sounds.map(sound => sound.duration).reduce((a, b) => Math.max(a, b), 0);
    }

    seek(time: number): void {
        this.sounds.forEach(sound => sound.seek && sound.seek(time));
    }

    addSound(sound: Sound): void {
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

    /**
     * Returns a boolean indicating whether the sound is currently playing.
     * @returns {boolean} True if the sound is playing, false otherwise.
     */
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
        return this.sounds[0].playbackRate;
    }

    set playbackRate(rate: number) {
        this.sounds.forEach(sound => sound.playbackRate = rate);
    }


}
