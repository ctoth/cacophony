import { IAudioParam } from "standardized-audio-context";

export enum EnvelopeType {
    Linear = 'linear',
    Exponential = 'exponential',
    Logarithmic = 'logarithmic'
}

export interface ADSREnvelope {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    sustainLevel: number;
    duration: number;
    minValue: number;
    maxValue: number;
    attackType: EnvelopeType;
    decayType: EnvelopeType;
    releaseType: EnvelopeType;
}

export class ADSR {
    envelope: ADSREnvelope;

    constructor(envelope: Partial<ADSREnvelope>) {
        this.envelope = {
            attack: 0,
            decay: 0,
            sustain: 0,
            release: 0,
            sustainLevel: 1,
            duration: 0,
            minValue: 0,
            maxValue: 1,
            attackType: EnvelopeType.Linear,
            decayType: EnvelopeType.Linear,
            releaseType: EnvelopeType.Linear,
            ...envelope
        };

        this.validateEnvelope();
    }

    private validateEnvelope(): void {
        if (this.envelope.duration > 0 && this.envelope.duration < this.getTotalDuration()) {
            console.warn('Envelope duration is shorter than the sum of ADSR phases. This may result in unexpected behavior.');
        }
    }

    updateEnvelope(newEnvelope: Partial<ADSREnvelope>): void {
        this.envelope = { ...this.envelope, ...newEnvelope };
        this.validateEnvelope();
    }

    getTotalDuration(): number {
        return this.envelope.attack + this.envelope.decay + this.envelope.sustain + this.envelope.release;
    }

    applyToParam(
        audioParam: IAudioParam,
        startTime: number,
        duration: number
    ): void {
        if (!duration || !this.envelope.duration) {
            // calculate duration based on all envelope properties including sustain.
            duration = this.envelope.attack + this.envelope.decay + this.envelope.sustain + this.envelope.release;
        }
        const endTime = startTime + duration;
        this.applyADSR(audioParam, this.envelope, startTime, endTime);
    }

    private applyADSR(
        audioParam: IAudioParam,
        envelope: ADSREnvelope,
        startTime: number,
        endTime: number
    ): void {
        const { attack, decay, sustain, release, sustainLevel, minValue, maxValue, attackType, decayType, releaseType } = envelope;
        
        const attackEnd = startTime + attack;
        const decayEnd = attackEnd + decay;
        const sustainEnd = decayEnd + sustain;
        const releaseEnd = Math.min(endTime, sustainEnd + release);
    
        // Apply attack
        audioParam.cancelScheduledValues(startTime);
        audioParam.setValueAtTime(minValue, startTime);
        this.applyEnvelopeSegment(audioParam, attackType, startTime, attackEnd, minValue, maxValue);
    
        // Apply decay
        this.applyEnvelopeSegment(audioParam, decayType, attackEnd, decayEnd, maxValue, sustainLevel);
    
        // Sustain
        audioParam.setValueAtTime(sustainLevel, decayEnd);
        
        // Apply release
        if (releaseEnd > sustainEnd) {
            this.applyEnvelopeSegment(audioParam, releaseType, sustainEnd, releaseEnd, sustainLevel, minValue);
        }
    }

    private applyEnvelopeSegment(
        audioParam: IAudioParam,
        envelopeType: EnvelopeType,
        startTime: number,
        endTime: number,
        startValue: number,
        endValue: number
    ): void {
        const duration = endTime - startTime;
        
        switch (envelopeType) {
            case EnvelopeType.Linear:
                audioParam.linearRampToValueAtTime(endValue, endTime);
                break;
            case EnvelopeType.Exponential:
                // Avoid zero values for exponential ramps
                const safeStartValue = Math.max(startValue, 0.0001);
                const safeEndValue = Math.max(endValue, 0.0001);
                audioParam.exponentialRampToValueAtTime(safeEndValue, endTime);
                break;
            case EnvelopeType.Logarithmic:
                // Implement logarithmic ramp using setValueCurveAtTime
                const curveLength = Math.ceil(duration * 1000); // 1 point per millisecond
                const curve = new Float32Array(curveLength);
                for (let i = 0; i < curveLength; i++) {
                    const t = i / (curveLength - 1);
                    curve[i] = startValue + (endValue - startValue) * (Math.log1p(t * 99) / Math.log(100));
                }
                audioParam.setValueCurveAtTime(curve, startTime, duration);
                break;
        }
    }
}
