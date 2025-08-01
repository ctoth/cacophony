import type { GainNode, MediaStreamAudioSourceNode } from './context';

import type { AudioContext, PannerNode } from "./context";

import type { BaseSound, LoopCount, Position } from "./cacophony";
import { FilterManager } from "./filters";

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


    /**
     * Indicates whether the audio is currently playing.
     * @returns {boolean} True if the audio is playing, false otherwise.
     */

    get isPlaying() {
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

    /**
     * A boolean indicating whether the sound is currently playing.
     * @returns {boolean} True if the sound is playing, false otherwise.
     */

    get isPlaying(): boolean {
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
