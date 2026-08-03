/**
 * FIR-Hilbert single-sideband frequency shifter.
 *
 * Scott Wardle, "A Hilbert-Transformer Frequency Shifter for Audio",
 * DAFx-98, eq. 5c:
 *
 *   y(t) = x(t) cos(w_c t) - H{x(t)} sin(w_c t)
 *
 * The real path is delayed by the FIR group delay so it remains in quadrature
 * with the Hilbert path. A signed carrier frequency chooses upper/lower
 * sideband translation without changing the algorithm.
 */

const DEFAULT_TAPS = 127;

/** Windowed ideal odd-symmetric Hilbert-transform FIR. */
export function designHilbertFir(tapCount = DEFAULT_TAPS): Float64Array {
  if (tapCount < 7 || tapCount % 2 === 0) {
    throw new RangeError("Hilbert FIR tap count must be an odd integer >= 7");
  }
  const center = (tapCount - 1) / 2;
  const coefficients = new Float64Array(tapCount);
  for (let n = 0; n < tapCount; n++) {
    const m = n - center;
    if (m !== 0 && Math.abs(m) % 2 === 1) {
      const window =
        0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (tapCount - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (tapCount - 1));
      coefficients[n] = (2 / (Math.PI * m)) * window;
    }
  }
  return coefficients;
}

export interface QuadratureSample {
  /** FIR-group-delay-aligned input. */
  direct: number;
  /** Approximately +90-degree Hilbert transform of the input. */
  quadrature: number;
}

/** Streaming FIR Hilbert transformer with an aligned direct tap. */
export class HilbertTransformer {
  readonly latencySamples: number;
  private readonly coefficients: Float64Array;
  private readonly buffer: Float64Array;
  private readonly mask: number;
  private writeIndex = 0;

  constructor(tapCount = DEFAULT_TAPS) {
    this.coefficients = designHilbertFir(tapCount);
    this.latencySamples = (tapCount - 1) / 2;
    const size = 2 ** Math.ceil(Math.log2(tapCount + 1));
    this.buffer = new Float64Array(size);
    this.mask = size - 1;
  }

  process(input: number): QuadratureSample {
    this.buffer[this.writeIndex] = input;
    let quadrature = 0;
    for (let i = 0; i < this.coefficients.length; i++) {
      quadrature += this.coefficients[i] * this.buffer[(this.writeIndex - i) & this.mask];
    }
    const direct = this.buffer[(this.writeIndex - this.latencySamples) & this.mask];
    this.writeIndex = (this.writeIndex + 1) & this.mask;
    return { direct, quadrature };
  }

  reset(): void {
    this.buffer.fill(0);
    this.writeIndex = 0;
  }
}

export interface FrequencyShifterParams {
  /** Signed translation in Hz. */
  frequency: number;
  /** Wet amount, 0 = latency-aligned dry, 1 = single-sideband output. */
  mix: number;
}

/** One-channel streaming SSB shifter. Create one instance per audio channel. */
export class FrequencyShifterCore {
  readonly hilbert: HilbertTransformer;
  private phase = 0;

  constructor(
    private readonly sampleRate: number,
    tapCount = DEFAULT_TAPS,
  ) {
    this.hilbert = new HilbertTransformer(tapCount);
  }

  processSample(input: number, params: FrequencyShifterParams): number {
    const pair = this.hilbert.process(input);
    const shifted = pair.direct * Math.cos(this.phase) - pair.quadrature * Math.sin(this.phase);
    const mix = Math.max(0, Math.min(1, params.mix));
    const frequency = Math.max(-this.sampleRate / 2, Math.min(this.sampleRate / 2, params.frequency));
    this.phase += (2 * Math.PI * frequency) / this.sampleRate;
    if (this.phase > Math.PI || this.phase < -Math.PI)
      this.phase -= Math.round(this.phase / (2 * Math.PI)) * 2 * Math.PI;
    return pair.direct * (1 - mix) + shifted * mix;
  }

  process(input: Float32Array, output: Float32Array, params: FrequencyShifterParams): void {
    for (let i = 0; i < input.length; i++) output[i] = this.processSample(input[i], params);
  }

  reset(): void {
    this.hilbert.reset();
    this.phase = 0;
  }
}
