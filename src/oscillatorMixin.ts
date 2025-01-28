import { BasePlayback } from "./basePlayback";
import type { OscillatorNode } from "./context";

export type OscillatorCloneOverrides = {
    oscillatorOptions?: Partial<OscillatorOptions>;
};

type Constructor<T = {}> = abstract new (...args: any[]) => T;

export function OscillatorMixin<TBase extends Constructor>(Base: TBase) {
    abstract class OscillatorMixin extends BasePlayback {
        _oscillatorOptions: Partial<OscillatorOptions> = {};
        declare public source?: OscillatorNode;

        get inputNode(): AudioNode {
            if (!this.source) {
                throw new Error('Cannot access nodes of a cleaned up sound');
            }
            return this.source;
        }

        get outputNode(): AudioNode {
            if (!this.source) {
                throw new Error('Cannot access nodes of a cleaned up sound');
            }
            return this.source;
        }

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
