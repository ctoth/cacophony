import { IOscillatorOptions } from "standardized-audio-context";
import { OscillatorNode } from "./context";
import { BasePlayback } from "./playback";

type Constructor<T = {}> = abstract new (...args: any[]) => T;

export function OscillatorMixin<TBase extends Constructor>(Base: TBase) {
    return class extends BasePlayback {

        private _oscillatorOptions: Partial<IOscillatorOptions> = {};
        declare public source?: OscillatorNode;

        get oscillatorOptions(): Partial<IOscillatorOptions> {
            return this._oscillatorOptions;
        }

        set oscillatorOptions(options: Partial<IOscillatorOptions>) {
            this._oscillatorOptions = options;
            if (this.source && this.source instanceof OscillatorNode) {
                Object.assign(this.source, options);
            }
        }

        play(): [this] {
            if (!this.source) {
                throw new Error('No source node found');
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

    };
}
