import { BasePlayback } from "./basePlayback";
import type { OscillatorNode } from "./context";
import { ADSR, ADSREnvelope } from "./adsr";
import { IAudioContext } from "standardized-audio-context";

export type OscillatorCloneOverrides = {
    oscillatorOptions?: Partial<OscillatorOptions>;
};

type Constructor<T = {}> = abstract new (...args: any[]) => T;

export function OscillatorMixin<TBase extends Constructor>(Base: TBase) {
    abstract class OscillatorMixin extends BasePlayback {
        _oscillatorOptions: Partial<OscillatorOptions> = {};
        oscillatorEnvelopes: OscillatorEnvelopes = {};
        declare public source?: OscillatorNode;
        declare public context: IAudioContext;

        get oscillatorOptions(): Partial<OscillatorOptions> {
            return this._oscillatorOptions;
        }

        set oscillatorOptions(options: Partial<OscillatorOptions>) {
            this._oscillatorOptions = options;
            if (this.source && this.source instanceof OscillatorNode) {
                if (this.oscillatorOptions.detune) this.source.detune.value = this.oscillatorOptions.detune;
                if (this.oscillatorOptions.frequency) this.source.frequency.value = this.oscillatorOptions.frequency;
                if (this.oscillatorOptions.type) this.source.type = this.oscillatorOptions.type;
            }
        }

        play(): [this] {
            if (!this.source) {
                throw new Error('No source node found');
            }
            if (this.oscillatorOptions.detune) this.source.detune.value = this.oscillatorOptions.detune;
            if (this.oscillatorOptions.frequency) this.source.frequency.value = this.oscillatorOptions.frequency;
            if (this.oscillatorOptions.type) this.source.type = this.oscillatorOptions.type;
            if (this.oscillatorEnvelopes.frequencyEnvelope) {
                this.oscillatorEnvelopes.frequencyEnvelope.applyToParam(this.source.frequency, this.context.currentTime, this.oscillatorEnvelopes.frequencyEnvelope.envelope.duration);
            }
            if (this.oscillatorEnvelopes.detuneEnvelope) {
                this.oscillatorEnvelopes.detuneEnvelope.applyToParam(this.source.detune, this.context.currentTime, this.oscillatorEnvelopes.detuneEnvelope.envelope.duration);
            }
            this.source.start();
            this._playing = true;
            return [this];
        }

        stop() {
            if (this.source && this.source.stop) {
                this.source.stop();
                this._playing = false;
            }
        }

        pause(): void {
            this.stop();
        }

        get frequency(): number {
            return this.source!.frequency.value;
        }

        set frequency(frequency: number) {
            this.source!.frequency.value = frequency;
            this.oscillatorOptions.frequency = frequency;
        }

        get detune(): number {
            return this.source!.detune.value;
        }

        set detune(detune: number) {
            this.source!.detune.value = detune;
            this.oscillatorOptions.detune = detune;
        }

        applyDetuneEnvelope(adsr: ADSREnvelope): void {
            const instance = new ADSR(adsr);
            this.oscillatorEnvelopes.detuneEnvelope = instance;
        }

        applyFrequencyEnvelope(adsr: ADSREnvelope): void {
            const instance = new ADSR(adsr);
            this.oscillatorEnvelopes.frequencyEnvelope = instance;
        }

        get type(): OscillatorType {
            return this.source!.type;
        }

        set type(type: OscillatorType) {
            this.source!.type = type;
            this.oscillatorOptions.type = type;
        }

    };
    return OscillatorMixin;
}

interface OscillatorEnvelopes {
    frequencyEnvelope?: ADSR;
    detuneEnvelope?: ADSR;
}