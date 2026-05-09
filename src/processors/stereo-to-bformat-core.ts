const BUTTERWORTH_Q = Math.SQRT1_2;

const LOW_CUTOFF_HZ = 250;
const HIGH_CUTOFF_HZ = 2000;

// Tier 1 perceptual tuning:
// - Keep low-band energy mostly omnidirectional.
// - Reduce W relative to the original sqrt(1/2) mapping.
// - Let upper bands carry more of the horizontal cue.
const W_GAIN_LOW = 0.5;
const W_GAIN_MID = 0.45;
const W_GAIN_HIGH = 0.35;
const X_GAIN_LOW = 0;
const X_GAIN_MID = 0.35;
const X_GAIN_HIGH = 0.55;
const Y_GAIN_LOW = 0;
const Y_GAIN_MID = 0.5;
const Y_GAIN_HIGH = 0.85;

type BiquadType = "lowpass" | "highpass";

class BiquadFilter {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: BiquadType, sampleRate: number, cutoffHz: number, q = BUTTERWORTH_Q) {
    this.configure(type, sampleRate, cutoffHz, q);
  }

  private configure(type: BiquadType, sampleRate: number, cutoffHz: number, q: number): void {
    const clampedCutoff = Math.max(1, Math.min(cutoffHz, sampleRate * 0.45));
    const omega = (2 * Math.PI * clampedCutoff) / sampleRate;
    const sin = Math.sin(omega);
    const cos = Math.cos(omega);
    const alpha = sin / (2 * q);

    let b0: number;
    let b1: number;
    let b2: number;

    if (type === "lowpass") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    }

    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(input: number): number {
    const output = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;

    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }
}

export class StereoToFoaUpmixer {
  private readonly lowLeft: BiquadFilter;
  private readonly lowRight: BiquadFilter;
  private readonly highLeft: BiquadFilter;
  private readonly highRight: BiquadFilter;

  constructor(sampleRate: number) {
    this.lowLeft = new BiquadFilter("lowpass", sampleRate, LOW_CUTOFF_HZ);
    this.lowRight = new BiquadFilter("lowpass", sampleRate, LOW_CUTOFF_HZ);
    this.highLeft = new BiquadFilter("highpass", sampleRate, HIGH_CUTOFF_HZ);
    this.highRight = new BiquadFilter("highpass", sampleRate, HIGH_CUTOFF_HZ);
  }

  process(
    left: Float32Array,
    right: Float32Array,
    w: Float32Array,
    y: Float32Array,
    z: Float32Array,
    x: Float32Array,
  ): void {
    const frameCount = Math.min(left.length, right.length, w.length, x.length, y.length, z.length);

    for (let frame = 0; frame < frameCount; frame++) {
      const leftSample = left[frame];
      const rightSample = right[frame];

      const lowLeft = this.lowLeft.process(leftSample);
      const lowRight = this.lowRight.process(rightSample);
      const highLeft = this.highLeft.process(leftSample);
      const highRight = this.highRight.process(rightSample);

      const midLeft = leftSample - lowLeft - highLeft;
      const midRight = rightSample - lowRight - highRight;

      const lowMid = (lowLeft + lowRight) * 0.5;
      const lowSide = (lowLeft - lowRight) * 0.5;
      const midMid = (midLeft + midRight) * 0.5;
      const midSide = (midLeft - midRight) * 0.5;
      const highMid = (highLeft + highRight) * 0.5;
      const highSide = (highLeft - highRight) * 0.5;

      w[frame] = lowMid * W_GAIN_LOW + midMid * W_GAIN_MID + highMid * W_GAIN_HIGH;
      y[frame] = lowSide * Y_GAIN_LOW + midSide * Y_GAIN_MID + highSide * Y_GAIN_HIGH;
      z[frame] = 0;
      x[frame] = lowMid * X_GAIN_LOW + midMid * X_GAIN_MID + highMid * X_GAIN_HIGH;
    }
  }
}

export function encodeStereoToBFormat(
  left: Float32Array,
  right: Float32Array,
  w: Float32Array,
  y: Float32Array,
  z: Float32Array,
  x: Float32Array,
  sampleRate: number,
): void {
  new StereoToFoaUpmixer(sampleRate).process(left, right, w, y, z, x);
}
