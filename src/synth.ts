import { ADSREnvelope } from "./adsr";
import { SoundType, type BaseSound, type PanType } from "./cacophony";
import { PlaybackContainer } from "./container";
import type { AudioContext, GainNode } from './context';
import type { FilterCloneOverrides } from "./filters";
import { FilterManager } from "./filters";
import { LFO } from "./lfo";
import type { OscillatorCloneOverrides } from "./oscillatorMixin";
import type { PanCloneOverrides } from "./pannerMixin";
import { SynthPlayback } from "./synthPlayback";
import type { VolumeCloneOverrides } from "./volumeMixin";

type SynthCloneOverrides = FilterCloneOverrides & OscillatorCloneOverrides & PanCloneOverrides & VolumeCloneOverrides

export class Synth extends PlaybackContainer(FilterManager) implements BaseSound {
    _oscillatorOptions: Partial<OscillatorOptions>;
    synthEnvelopes: SynthEnvelopes = {};
    playbacks: SynthPlayback[] = [];
    frequencyLFO?: LFO;
    detuneLFO?: LFO;
    volumeLFO?: LFO;

    constructor(
        public context: AudioContext,
        private globalGainNode: GainNode,
        public soundType: SoundType = SoundType.Oscillator,
        public panType: PanType = 'HRTF',
        oscillatorOptions: Partial<OscillatorOptions> = {}
    ) {
        super();
        this.context = context;
        this._oscillatorOptions = oscillatorOptions;
    }

    /**
     * Clones the current Synth instance, creating a deep copy with the option to override specific properties.
     * This method allows for the creation of a new, independent Synth instance based on the current one, with the
     * flexibility to modify certain attributes through the `overrides` parameter. This is particularly useful for
     * creating variations of a synth without affecting the original instance. The cloned instance includes all properties,
     * playback settings, and filters of the original, unless explicitly overridden.
     *
     * @param {SynthCloneOverrides} overrides - An object specifying properties to override in the cloned instance.
     *        This can include audio settings like volume, playback rate, and spatial positioning, as well as
     *        more complex configurations like 3D audio options and filter adjustments.
     * @returns {Sound} A new Sound instance that is a clone of the current sound.
     */
    clone(overrides: Partial<SynthCloneOverrides> = {}): Synth {
        const panType = overrides.panType || this.panType;
        const stereoPan = overrides.stereoPan !== undefined ? overrides.stereoPan : (this.stereoPan ?? 0);
        const threeDOptions = (overrides.threeDOptions || this.threeDOptions) as PannerOptions;
        const volume = overrides.volume !== undefined ? overrides.volume : this.volume;
        const position = overrides.position && overrides.position.length ? overrides.position : this.position;
        const filters = overrides.filters && overrides.filters.length ? overrides.filters : this._filters;
        const oscillatorOptions = overrides.oscillatorOptions || this._oscillatorOptions;

        const clone = new Synth(this.context, this.globalGainNode, this.soundType, panType, oscillatorOptions);
        clone._volume = volume;
        clone._position = position;
        clone._stereoPan = stereoPan as number;
        clone._threeDOptions = threeDOptions;
        clone.addFilters(filters);
        return clone;
    }

    /**
     * Generates a Playback instance for the synth without starting playback.
     * This allows for pre-configuration of playback properties such as volume and position before the synth is actually played.
     * @returns {SynthPlayback[]} An array of SynthPlayback instances that are ready to be played.
     */
    preplay(): SynthPlayback[] {
        const oscillator = this.context.createOscillator();
        if (this.oscillatorOptions.detune) oscillator.detune.value = this.oscillatorOptions.detune;
        if (this.oscillatorOptions.frequency) oscillator.frequency.value = this.oscillatorOptions.frequency;
        if (this.oscillatorOptions.type) oscillator.type = this.oscillatorOptions.type;

        const gainNode = this.context.createGain();
        gainNode.connect(this.globalGainNode);
        const playback = new SynthPlayback(oscillator, gainNode, this.context, this.panType);
        playback.volume = this.volume;
        this._filters.forEach(filter => playback.addFilter(filter));

        // Envelope handling
        playback.synthEnvelopes = { ...this.synthEnvelopes };
        if (this.synthEnvelopes.detuneEnvelope) playback.applyDetuneEnvelope(this.synthEnvelopes.detuneEnvelope);
        if (this.synthEnvelopes.frequencyEnvelope) playback.applyFrequencyEnvelope(this.synthEnvelopes.frequencyEnvelope);
        if (this.synthEnvelopes.volumeEnvelope) playback.applyVolumeEnvelope(this.synthEnvelopes.volumeEnvelope);

        if (this.panType === 'HRTF') {
            playback.threeDOptions = this.threeDOptions;
            playback.position = this.position;
        } else if (this.panType === 'stereo') {
            playback.stereoPan = this.stereoPan as number;
        }
        this.playbacks.push(playback);
        return [playback];
    }

    get oscillatorOptions(): Partial<OscillatorOptions> {
        return this._oscillatorOptions;
    }

    set oscillatorOptions(options: Partial<OscillatorOptions>) {
        this._oscillatorOptions = options;
        this.playbacks.forEach(p => {
            if (p.source instanceof OscillatorNode) {
                if (this.oscillatorOptions.detune) p.source.detune.value = this.oscillatorOptions.detune;
                if (this.oscillatorOptions.frequency) p.source.frequency.value = this.oscillatorOptions.frequency;
                if (this.oscillatorOptions.type) p.source.type = this.oscillatorOptions.type;
            }
        });
    }

    get frequency(): number {
        return this.oscillatorOptions.frequency as number || 440;
    }

    set frequency(frequency: number) {
        this._oscillatorOptions.frequency = frequency;
        this.playbacks.forEach((p) =>
            p.frequency = frequency);
    }

    get detune(): number {
        return this.oscillatorOptions.detune as number;
    }

    set detune(detune: number) {
        this._oscillatorOptions.detune = detune;
        this.playbacks.forEach((p) =>
            p.detune = detune);
    }

    get type(): OscillatorType {
        return this.oscillatorOptions.type as OscillatorType || 'sine';
    }

    set type(type: OscillatorType) {
        this._oscillatorOptions.type = type;
        this.playbacks.forEach((p) =>
            p.type = type);
    }

    applyFrequencyEnvelope(envelope: ADSREnvelope): void {
        this.synthEnvelopes.frequencyEnvelope = envelope;
        this.playbacks.forEach(p => p.applyFrequencyEnvelope(envelope));
    }

    applyDetuneEnvelope(envelope: ADSREnvelope): void {
        this.synthEnvelopes.detuneEnvelope = envelope;
        this.playbacks.forEach(p => p.applyDetuneEnvelope(envelope));
    }

    applyVolumeEnvelope(envelope: ADSREnvelope): void {
        this.synthEnvelopes.volumeEnvelope = envelope;
        this.playbacks.forEach(p => p.applyVolumeEnvelope(envelope));
    }

    setFrequencyLFO(frequency: number, amplitude: number, waveform: OscillatorType = 'sine'): void {
        this.frequencyLFO = new LFO(this.context, frequency, amplitude, waveform);
        this.playbacks.forEach(p => {
            if (p.source instanceof OscillatorNode) {
                this.frequencyLFO!.connect(p.source.frequency);
            }
        });
        this.frequencyLFO.start();
    }

    setDetuneLFO(frequency: number, amplitude: number, waveform: OscillatorType = 'sine'): void {
        this.detuneLFO = new LFO(this.context, frequency, amplitude, waveform);
        this.playbacks.forEach(p => {
            if (p.source instanceof OscillatorNode) {
                this.detuneLFO!.connect(p.source.detune);
            }
        });
        this.detuneLFO.start();
    }

    setVolumeLFO(frequency: number, amplitude: number, waveform: OscillatorType = 'sine'): void {
        this.volumeLFO = new LFO(this.context, frequency, amplitude, waveform);
        this.playbacks.forEach(p => {
            this.volumeLFO!.connect(p.gainNode.gain);
        });
        this.volumeLFO.start();
    }

    stopLFOs(): void {
        if (this.frequencyLFO) this.frequencyLFO.stop();
        if (this.detuneLFO) this.detuneLFO.stop();
        if (this.volumeLFO) this.volumeLFO.stop();
    }
}

export interface SynthEnvelopes {
    volumeEnvelope?: ADSREnvelope;
    frequencyEnvelope?: ADSREnvelope;
    detuneEnvelope?: ADSREnvelope;
}
