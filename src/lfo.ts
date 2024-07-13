import { IAudioContext, IAudioParam } from "standardized-audio-context";

export class LFO {
    private oscillator: OscillatorNode;
    private gainNode: GainNode;
    private depthNode: GainNode;
    private offsetNode: ConstantSourceNode;
    private customWaveform: PeriodicWave | null = null;
    private isPlaying: boolean = false;
    private pausedAt: number | null = null;

    constructor(
        private context: IAudioContext,
        public frequency: number = 1,
        public depth: number = 1,
        public waveform: OscillatorType | 'custom' = 'sine',
        public phase: number = 0,
        public bipolar: boolean = false,
        customShape?: number[]
    ) {
        this.oscillator = this.context.createOscillator();
        this.gainNode = this.context.createGain();
        this.depthNode = this.context.createGain();
        this.offsetNode = this.context.createConstantSource();

        if (waveform === 'custom' && customShape) {
            this.setCustomWaveform(customShape);
        } else {
            this.oscillator.type = waveform as OscillatorType;
        }
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
        if (!this.isPlaying) {
            this.oscillator.start(time);
            this.offsetNode.start(time);
            this.isPlaying = true;
            this.pausedAt = null;
        }
    }

    stop(time?: number): void {
        if (this.isPlaying) {
            this.oscillator.stop(time);
            this.offsetNode.stop(time);
            this.isPlaying = false;
            this.pausedAt = null;
        }
    }

    pause(): void {
        if (this.isPlaying) {
            this.stop(this.context.currentTime);
            this.pausedAt = this.context.currentTime;
        }
    }

    resume(): void {
        if (this.pausedAt !== null) {
            this.start(this.context.currentTime);
            this.syncToTime(this.pausedAt);
            this.pausedAt = null;
        }
    }

    reset(): void {
        this.stop();
        this.oscillator = this.context.createOscillator();
        if (this.customWaveform) {
            this.oscillator.setPeriodicWave(this.customWaveform);
        } else {
            this.oscillator.type = this.waveform as OscillatorType;
        }
        this.oscillator.frequency.value = this.frequency;
        this.oscillator.connect(this.gainNode);
        this.setPhase(this.phase);
    }

    setFrequency(value: number, time?: number): void {
        this.oscillator.frequency.setValueAtTime(value, time || this.context.currentTime);
        this.frequency = value;
    }

    setDepth(value: number, time?: number): void {
        this.depthNode.gain.setValueAtTime(value, time || this.context.currentTime);
        this.depth = value;
    }

    setWaveform(waveform: OscillatorType | 'custom', customShape?: number[]): void {
        if (waveform === 'custom' && customShape) {
            this.setCustomWaveform(customShape);
        } else {
            this.oscillator.type = waveform as OscillatorType;
            this.customWaveform = null;
        }
        this.waveform = waveform;
    }

    setCustomWaveform(shape: number[]): void {
        const real = new Float32Array(shape.length);
        const imag = new Float32Array(shape.length);
        shape.forEach((value, index) => {
            real[index] = 0;
            imag[index] = value;
        });
        this.customWaveform = this.context.createPeriodicWave(real, imag);
        this.oscillator.setPeriodicWave(this.customWaveform);
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

    modulateDepth(depth: number, duration: number): void {
        const now = this.context.currentTime;
        this.depthNode.gain.setValueAtTime(this.depth, now);
        this.depthNode.gain.linearRampToValueAtTime(depth, now + duration);
        this.depth = depth;
    }

    static synchronize(...lfos: LFO[]): void {
        const now = lfos[0].context.currentTime;
        lfos.forEach(lfo => lfo.syncToTime(now));
    }
}
