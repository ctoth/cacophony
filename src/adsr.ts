import { IAudioParam } from "standardized-audio-context";

export interface ADSREnvelope {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    sustainLevel: number;
    duration: number;
    minValue: number;
    maxValue: number;
}

export class ADSR {
    envelope: ADSREnvelope;

    constructor(envelope: ADSREnvelope) {
        this.envelope = envelope;
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
        let { attack, decay, sustain, release, sustainLevel, minValue, maxValue } = envelope;
        if (!minValue) minValue = 0;
        if (!maxValue) maxValue = 1;
    
        const attackEnd = startTime + attack;
        const decayEnd = attackEnd + decay;
        const releaseStart = endTime;
    
        // Apply attack
        audioParam.cancelScheduledValues(startTime);
        audioParam.setValueAtTime(minValue, startTime);
        audioParam.linearRampToValueAtTime(maxValue, attackEnd);
    
        // Apply decay
        audioParam.linearRampToValueAtTime(sustainLevel, decayEnd);
    
        // Sustain value should be held until the release phase
        audioParam.setValueAtTime(sustainLevel, releaseStart);
    
        // Apply release
        const releaseEnd = releaseStart + release;
        audioParam.linearRampToValueAtTime(minValue, releaseEnd);
    }
}
