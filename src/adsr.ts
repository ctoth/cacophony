import { IAudioParam } from "standardized-audio-context";

export interface ADSREnvelope {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    sustainLevel: number;
    duration: number;
}

export function applyADSR(
    audioParam: IAudioParam,
    envelope: ADSREnvelope,
    startTime: number,
    endTime: number
): void {
    const { attack, decay, sustain, release, sustainLevel } = envelope;

    const attackEnd = startTime + attack;
    const decayEnd = attackEnd + decay;
    const releaseStart = endTime;

    // Apply attack
    audioParam.cancelScheduledValues(startTime);
    audioParam.setValueAtTime(0, startTime);
    audioParam.linearRampToValueAtTime(1, attackEnd);

    // Apply decay
    audioParam.linearRampToValueAtTime(sustainLevel, decayEnd);

    // Sustain value should be held until the release phase
    audioParam.setValueAtTime(sustainLevel, releaseStart);

    // Apply release
    const releaseEnd = releaseStart + release;
    audioParam.linearRampToValueAtTime(0, releaseEnd);
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
        const endTime = startTime + duration;
        applyADSR(audioParam, this.envelope, startTime, endTime);
    }
}