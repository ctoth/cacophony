const wrapPhase = (phase: number): number => Math.atan2(Math.sin(phase), Math.cos(phase));

/** Stateful spectral-frame freezer with phase continuation and 3-frame magnitude smear. */
export class SpectralFreezeState {
  private readonly previous: Float32Array;
  private readonly heldMagnitude: Float32Array;
  private readonly heldPhase: Float64Array;
  private readonly phaseStep: Float64Array;
  private readonly magnitudeHistory: Float32Array[];
  private historyIndex = 0;
  private historyCount = 0;
  private wasFrozen = false;
  private hasPrevious = false;

  constructor(
    private readonly binCount: number,
    private readonly fftSize: number,
    private readonly hopSize: number,
  ) {
    this.previous = new Float32Array(fftSize * 2);
    this.heldMagnitude = new Float32Array(binCount);
    this.heldPhase = new Float64Array(binCount);
    this.phaseStep = new Float64Array(binCount);
    this.magnitudeHistory = Array.from({ length: 3 }, () => new Float32Array(binCount));
  }

  process(input: Float32Array, output: Float32Array, frozen: boolean, smear: number, mix: number): void {
    const currentMagnitudes = this.magnitudeHistory[this.historyIndex];
    for (let bin = 0; bin < this.binCount; bin++) {
      const i = bin * 2;
      currentMagnitudes[bin] = Math.hypot(input[i], input[i + 1]);
    }
    this.historyIndex = (this.historyIndex + 1) % this.magnitudeHistory.length;
    this.historyCount = Math.min(this.magnitudeHistory.length, this.historyCount + 1);

    if (frozen && !this.wasFrozen) {
      const smearAmount = Math.max(0, Math.min(1, smear));
      for (let bin = 0; bin < this.binCount; bin++) {
        const i = bin * 2;
        let average = 0;
        for (let h = 0; h < this.historyCount; h++) average += this.magnitudeHistory[h][bin];
        average /= this.historyCount;
        this.heldMagnitude[bin] = currentMagnitudes[bin] * (1 - smearAmount) + average * smearAmount;
        this.heldPhase[bin] = Math.atan2(input[i + 1], input[i]);
        if (this.hasPrevious) {
          const crossReal = input[i] * this.previous[i] + input[i + 1] * this.previous[i + 1];
          const crossImag = input[i + 1] * this.previous[i] - input[i] * this.previous[i + 1];
          this.phaseStep[bin] = Math.atan2(crossImag, crossReal);
        } else {
          this.phaseStep[bin] = (2 * Math.PI * bin * this.hopSize) / this.fftSize;
        }
      }
    }

    const wet = Math.max(0, Math.min(1, mix));
    if (frozen) {
      for (let bin = 0; bin < this.binCount; bin++) {
        if (this.wasFrozen) this.heldPhase[bin] = wrapPhase(this.heldPhase[bin] + this.phaseStep[bin]);
        const i = bin * 2;
        const heldReal = this.heldMagnitude[bin] * Math.cos(this.heldPhase[bin]);
        const heldImag = this.heldMagnitude[bin] * Math.sin(this.heldPhase[bin]);
        output[i] = input[i] * (1 - wet) + heldReal * wet;
        output[i + 1] = input[i + 1] * (1 - wet) + heldImag * wet;
      }
    } else {
      output.set(input);
    }

    this.previous.set(input);
    this.hasPrevious = true;
    this.wasFrozen = frozen;
  }
}
