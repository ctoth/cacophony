import { IAudioContext, IAudioParam } from "standardized-audio-context";

export class LFO {
    private oscillator: OscillatorNode;
    private gainNode: GainNode;

    constructor(
        private context: IAudioContext,
        public frequency: number = 1,
        public amplitude: number = 1,
        public waveform: OscillatorType = 'sine'
    ) {
        this.oscillator = this.context.createOscillator();
        this.gainNode = this.context.createGain();

        this.oscillator.type = this.waveform;
        this.oscillator.frequency.value = this.frequency;
        this.gainNode.gain.value = this.amplitude;

        this.oscillator.connect(this.gainNode);
    }

    connect(param: IAudioParam): void {
        this.gainNode.connect(param as AudioParam);
    }

    disconnect(): void {
        this.gainNode.disconnect();
    }

    start(time?: number): void {
        this.oscillator.start(time);
    }

    stop(time?: number): void {
        this.oscillator.stop(time);
    }

    setFrequency(value: number, time?: number): void {
        this.oscillator.frequency.setValueAtTime(value, time || this.context.currentTime);
        this.frequency = value;
    }

    setAmplitude(value: number, time?: number): void {
        this.gainNode.gain.setValueAtTime(value, time || this.context.currentTime);
        this.amplitude = value;
    }

    setWaveform(waveform: OscillatorType): void {
        this.oscillator.type = waveform;
        this.waveform = waveform;
    }
}
