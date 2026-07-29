import { BasePlayback } from "./basePlayback";
import type { OscillatorNode } from "./context";

export type OscillatorCloneOverrides = {
  oscillatorOptions?: Partial<OscillatorOptions>;
};

export abstract class OscillatorMixin extends BasePlayback {
  _oscillatorOptions: Partial<OscillatorOptions> = {};
  public declare source?: OscillatorNode;

  get oscillatorOptions(): Partial<OscillatorOptions> {
    return this._oscillatorOptions;
  }

  set oscillatorOptions(options: Partial<OscillatorOptions>) {
    this._oscillatorOptions = options;
    if (this.source) {
      if (this.oscillatorOptions.detune !== undefined) this.source.detune.value = this.oscillatorOptions.detune;
      if (this.oscillatorOptions.frequency !== undefined)
        this.source.frequency.value = this.oscillatorOptions.frequency;
      if (this.oscillatorOptions.type) this.source.type = this.oscillatorOptions.type;
    }
  }

  get frequency(): number {
    if (!this.source) {
      throw new Error("No source node found");
    }
    return this.source.frequency.value;
  }

  set frequency(frequency: number) {
    if (!this.source) {
      throw new Error("No source node found");
    }
    this.source.frequency.value = frequency;
    this.oscillatorOptions.frequency = frequency;
  }

  get detune(): number {
    if (!this.source) {
      throw new Error("No source node found");
    }
    return this.source.detune.value;
  }

  set detune(detune: number) {
    if (!this.source) {
      throw new Error("No source node found");
    }
    this.source.detune.value = detune;
    this.oscillatorOptions.detune = detune;
  }

  get type(): OscillatorType {
    if (!this.source) {
      throw new Error("No source node found");
    }
    return this.source.type;
  }

  set type(type: OscillatorType) {
    if (!this.source) {
      throw new Error("No source node found");
    }
    this.source.type = type;
    this.oscillatorOptions.type = type;
  }
}
