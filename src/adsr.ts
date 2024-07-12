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
            ...envelope,
            attackType: envelope.attackType || EnvelopeType.Linear,
            decayType: envelope.decayType || EnvelopeType.Linear,
            releaseType: envelope.releaseType || EnvelopeType.Linear
        } as ADSREnvelope;
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
        let { attack, decay, sustain, release, sustainLevel, minValue, maxValue, attackType, decayType, releaseType } = envelope;
        if (!minValue) minValue = 0;
        if (!maxValue) maxValue = 1;
    
        const attackEnd = startTime + attack;
        const decayEnd = attackEnd + decay;
        const releaseStart = endTime;
    
        // Apply attack
        audioParam.cancelScheduledValues(startTime);
        audioParam.setValueAtTime(minValue, startTime);
        this.applyEnvelopeSegment(audioParam, attackType, startTime, attackEnd, minValue, maxValue);
    
        // Apply decay
        this.applyEnvelopeSegment(audioParam, decayType, attackEnd, decayEnd, maxValue, sustainLevel);
    
        // Sustain value should be held until the release phase
        audioParam.setValueAtTime(sustainLevel, releaseStart);
    
        // Apply release
        const releaseEnd = releaseStart + release;
        this.applyEnvelopeSegment(audioParam, releaseType, releaseStart, releaseEnd, sustainLevel, minValue);
    }

    private applyEnvelopeSegment(
        audioParam: IAudioParam,
        envelopeType: EnvelopeType,
        startTime: number,
        endTime: number,
        startValue: number,
        endValue: number
    ): void {
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
                const curveLength = 100;
                const curve = new Float32Array(curveLength);
                for (let i = 0; i < curveLength; i++) {
                    const t = i / (curveLength - 1);
                    curve[i] = startValue + (endValue - startValue) * Math.log1p(t) / Math.log1p(1);
                }
                audioParam.setValueCurveAtTime(curve, startTime, endTime - startTime);
                break;
        }
    }
}
