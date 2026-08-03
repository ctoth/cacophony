import { HilbertTransformer } from "./frequency-shifter-core";

/** First-order allpass A(z)=(a+z^-1)/(1+a z^-1), DAFx-15 eq. 14. */
class FirstOrderAllpass {
  private x1 = 0;
  private y1 = 0;

  process(input: number, coefficient: number): number {
    const output = coefficient * input + this.x1 - coefficient * this.y1;
    this.x1 = input;
    this.y1 = output;
    return output;
  }
}

export interface BarberpoleParams {
  /** Signed SSB translation rate/direction in Hz (rho in DAFx-15). */
  rate: number;
  /** Number of spectral-delay allpasses; two stages produce one moving notch. */
  stages: number;
  /** Allpass coefficient; -0.5 approximates octave-spaced group delay. */
  coefficient: number;
  /** Blend from aligned dry to the dry+shifted barberpole sum. */
  mix: number;
}

/**
 * SSB barberpole phaser from Esqueda, Valimaki & Parker, DAFx-15 Fig. 12.
 * The Hilbert shifter supplies the moving copy; a cascaded allpass spectral
 * delay warps the notch spacing toward the Shepard-Risset octave distribution.
 */
export class BarberpoleCore {
  private readonly hilbert = new HilbertTransformer();
  private readonly allpasses = Array.from({ length: 64 }, () => new FirstOrderAllpass());
  private phase = 0;

  constructor(private readonly sampleRate: number) {}

  processSample(input: number, params: BarberpoleParams): number {
    const pair = this.hilbert.process(input);
    let shifted = pair.direct * Math.cos(this.phase) - pair.quadrature * Math.sin(this.phase);
    const stages = Math.max(2, Math.min(this.allpasses.length, Math.round(params.stages)));
    const coefficient = Math.max(-0.95, Math.min(0.95, params.coefficient));
    for (let i = 0; i < stages; i++) shifted = this.allpasses[i].process(shifted, coefficient);

    const rate = Math.max(-2, Math.min(2, params.rate));
    this.phase += (2 * Math.PI * rate) / this.sampleRate;
    if (this.phase > Math.PI || this.phase < -Math.PI)
      this.phase -= Math.round(this.phase / (2 * Math.PI)) * 2 * Math.PI;

    const barberpole = 0.5 * (pair.direct + shifted);
    const mix = Math.max(0, Math.min(1, params.mix));
    return pair.direct * (1 - mix) + barberpole * mix;
  }

  process(input: Float32Array, output: Float32Array, params: BarberpoleParams): void {
    for (let i = 0; i < input.length; i++) output[i] = this.processSample(input[i], params);
  }
}
