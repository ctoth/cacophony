import { Playback } from "./playback";
import { OscillatorNode, IOscillatorOptions } from "standardized-audio-context";

type Constructor<T = {}> = abstract new (...args: any[]) => T;

export function OscillatorMixin<TBase extends Constructor>(Base: TBase) {
    return class extends Playback {
        private _oscillatorOptions: Partial<IOscillatorOptions> = {};

        get oscillatorOptions(): Partial<IOscillatorOptions> {
            return this._oscillatorOptions;
        }

        set oscillatorOptions(options: Partial<IOscillatorOptions>) {
            this._oscillatorOptions = options;
            if (this.source && this.source instanceof OscillatorNode) {
                Object.assign(this.source, options);
            }
        }
    };
}
