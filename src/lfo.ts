import { IAudioContext, IAudioParam } from "standardized-audio-context";

export class LFO {
    private oscillator: OscillatorNode;
    private gainNode: GainNode;
    private depthNode: GainNode;
    private offsetNode: ConstantSourceNode;

    constructor(
        private context: IAudioContext,
        public frequency: number = 1,
        public depth: number = 1,
        public waveform: OscillatorType = 'sine',
        public phase: number = 0,
        public bipolar: boolean = false
    ) {
        this.oscillator = this.context.createOscillator();
        this.gainNode = this.context.createGain();
        this.depthNode = this.context.createGain();
        this.offsetNode = this.context.createConstantSource();

        this.oscillator.type = this.waveform;
        this.oscillator.frequency.value = this.frequency;
        this.depthNode.gain.value = this.depth;
        this.offsetNode.offset.value = this.bipolar ? 0 : 0.5;

        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(this.depthNode);
        this.depthNode.connect(this.offsetNode);

        this.setPhase(this.phase);
    }

    connect(param: IAudioParam): void {
        this.offsetNode.connect(param as AudioParam);
    }

    disconnect(): void {
        this.offsetNode.disconnect();
    }

    start(time?: number): void {
        this.oscillator.start(time);
        this.offsetNode.start(time);
    }

    stop(time?: number): void {
        this.oscillator.stop(time);
        this.offsetNode.stop(time);
    }

    setFrequency(value: number, time?: number): void {
        this.oscillator.frequency.setValueAtTime(value, time || this.context.currentTime);
        this.frequency = value;
    }

    setDepth(value: number, time?: number): void {
        this.depthNode.gain.setValueAtTime(value, time || this.context.currentTime);
        this.depth = value;
    }

    setWaveform(waveform: OscillatorType): void {
        this.oscillator.type = waveform;
        this.waveform = waveform;
    }

    setPhase(phase: number): void {
        const normalizedPhase = ((phase % 360) + 360) % 360;
        const delayTime = (normalizedPhase / 360) / this.frequency;
        this.oscillator.disconnect();
        const delayNode = this.context.createDelay(delayTime);
        this.oscillator.connect(delayNode);
        delayNode.connect(this.gainNode);
        this.phase = normalizedPhase;
    }

    setBipolar(bipolar: boolean): void {
        this.bipolar = bipolar;
        this.offsetNode.offset.setValueAtTime(
            bipolar ? 0 : 0.5,
            this.context.currentTime
        );
    }

    syncToTime(time: number): void {
        const currentTime = this.context.currentTime;
        const phaseDifference = (time - currentTime) * this.frequency % 1;
        this.setPhase(phaseDifference * 360);
    }
}
