/*
Dattorro Reverb AudioWorklet Implementation
Original JavaScript implementation by Khôi Nguyễn (khoin)
https://github.com/khoin/DattorroReverbNode

Based on Jon Dattorro's 1997 AES paper:
"Effect Design Part 1: Reverberator and Other Filters"

In jurisdictions that recognize copyright laws, this software is to
be released into the public domain.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
THE AUTHOR(S) SHALL NOT BE LIABLE FOR ANYTHING, ARISING FROM, OR IN
CONNECTION WITH THE SOFTWARE OR THE DISTRIBUTION OF THE SOFTWARE.
*/

/**
 * Delay line structure: [buffer, writeIndex, readIndex, mask]
 * - buffer: Float32Array for storing samples
 * - writeIndex: Current write position
 * - readIndex: Current read position
 * - mask: Bitmask for wrapping (power of 2 - 1)
 */
type DelayLine = [Float32Array, number, number, number];

/**
 * Dattorro Plate Reverb AudioWorkletProcessor
 *
 * Based on Jon Dattorro's 1997 AES paper "Effect Design Part 1: Reverberator and Other Filters"
 * Implements a high-quality plate reverb algorithm with modulated delay lines.
 *
 * @see https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf
 */
export class DattorroReverbProcessor extends AudioWorkletProcessor {
  private _Delays: DelayLine[] = [];
  private _pDLength: number;
  private _preDelay: Float32Array;
  private _pDWrite: number = 0;
  private _lp1: number = 0.0;
  private _lp2: number = 0.0;
  private _lp3: number = 0.0;
  private _excPhase: number = 0.0;
  private _taps: Int16Array;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ["preDelay", 0, 0, sampleRate - 1, "k-rate"],
      ["bandwidth", 0.9999, 0, 1, "k-rate"],
      ["inputDiffusion1", 0.75, 0, 1, "k-rate"],
      ["inputDiffusion2", 0.625, 0, 1, "k-rate"],
      ["decay", 0.5, 0, 1, "k-rate"],
      ["decayDiffusion1", 0.7, 0, 0.999999, "k-rate"],
      ["decayDiffusion2", 0.5, 0, 0.999999, "k-rate"],
      ["damping", 0.005, 0, 1, "k-rate"],
      ["excursionRate", 0.5, 0, 2, "k-rate"],
      ["excursionDepth", 0.7, 0, 2, "k-rate"],
      ["wet", 0.3, 0, 1, "k-rate"],
      ["dry", 0.6, 0, 1, "k-rate"],
    ].map(([name, defaultValue, minValue, maxValue, automationRate]) => ({
      name: name as string,
      defaultValue: defaultValue as number,
      minValue: minValue as number,
      maxValue: maxValue as number,
      automationRate: automationRate as AutomationRate,
    }));
  }

  constructor(options: AudioWorkletNodeOptions) {
    super(options);

    // Pre-delay is always one-second long, rounded to the nearest 128-chunk
    this._pDLength = sampleRate + (128 - (sampleRate % 128));
    this._preDelay = new Float32Array(this._pDLength);

    // Initialize delay lines with specified lengths (in seconds)
    [
      0.004771345, 0.003595309, 0.012734787, 0.009307483, 0.022579886,
      0.149625349, 0.060481839, 0.1249958, 0.030509727, 0.141695508,
      0.089244313, 0.106280031,
    ].forEach((length) => this.makeDelay(length));

    // Initialize tap positions (in seconds) for stereo output
    this._taps = Int16Array.from(
      [
        0.008937872, 0.099929438, 0.064278754, 0.067067639, 0.066866033,
        0.006283391, 0.035818689, 0.011861161, 0.121870905, 0.041262054,
        0.08981553, 0.070931756, 0.011256342, 0.004065724,
      ],
      (length) => Math.round(length * sampleRate)
    );
  }

  /**
   * Creates a delay line with the specified length
   * Uses power-of-2 sizing for efficient wrapping with bitwise AND
   */
  private makeDelay(length: number): void {
    const len = Math.round(length * sampleRate);
    const nextPow2 = 2 ** Math.ceil(Math.log2(len));
    this._Delays.push([
      new Float32Array(nextPow2),
      len - 1, // write index
      0, // read index
      nextPow2 - 1, // mask for wrapping
    ]);
  }

  /**
   * Writes a sample to a delay line and returns the written value
   */
  private writeDelay(index: number, data: number): number {
    return (this._Delays[index][0][this._Delays[index][1]] = data);
  }

  /**
   * Reads the current sample from a delay line
   */
  private readDelay(index: number): number {
    return this._Delays[index][0][this._Delays[index][2]];
  }

  /**
   * Reads a sample at a specific offset from the current read position
   */
  private readDelayAt(index: number, offset: number): number {
    const d = this._Delays[index];
    return d[0][(d[2] + offset) & d[3]];
  }

  /**
   * Reads a sample with cubic interpolation at a fractional offset
   * Uses Olli Niemitalo's optimal cubic interpolation
   * @see https://www.musicdsp.org/en/latest/Other/49-cubic-interpollation.html
   */
  private readDelayCAt(index: number, offset: number): number {
    const d = this._Delays[index];
    const frac = offset - ~~offset;
    let int = ~~offset + d[2] - 1;
    const mask = d[3];

    const x0 = d[0][int++ & mask];
    const x1 = d[0][int++ & mask];
    const x2 = d[0][int++ & mask];
    const x3 = d[0][int & mask];

    const a = (3 * (x1 - x2) - x0 + x3) / 2;
    const b = 2 * x2 + x0 - (5 * x1 + x3) / 2;
    const c = (x2 - x0) / 2;

    return ((a * frac + b) * frac + c) * frac + x1;
  }

  /**
   * Process audio samples
   * First input will be downmixed to mono if number of channels is not 2
   * Outputs stereo
   */
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: AudioParamMap
  ): boolean {
    const pd = ~~parameters.preDelay[0];
    const bw = parameters.bandwidth[0];
    const fi = parameters.inputDiffusion1[0];
    const si = parameters.inputDiffusion2[0];
    const dc = parameters.decay[0];
    const ft = parameters.decayDiffusion1[0];
    const st = parameters.decayDiffusion2[0];
    const dp = 1 - parameters.damping[0];
    const ex = parameters.excursionRate[0] / sampleRate;
    const ed = (parameters.excursionDepth[0] * sampleRate) / 1000;
    const we = parameters.wet[0] * 0.6; // lo & ro both mult. by 0.6 anyways
    const dr = parameters.dry[0];

    // Write to predelay and dry output
    if (inputs[0].length === 2) {
      for (let i = 127; i >= 0; i--) {
        this._preDelay[this._pDWrite + i] =
          (inputs[0][0][i] + inputs[0][1][i]) * 0.5;

        outputs[0][0][i] = inputs[0][0][i] * dr;
        outputs[0][1][i] = inputs[0][1][i] * dr;
      }
    } else if (inputs[0].length > 0) {
      this._preDelay.set(inputs[0][0], this._pDWrite);
      for (let i = 127; i >= 0; i--) {
        outputs[0][0][i] = outputs[0][1][i] = inputs[0][0][i] * dr;
      }
    } else {
      this._preDelay.set(new Float32Array(128), this._pDWrite);
    }

    let i = 0;
    while (i < 128) {
      let lo = 0.0;
      let ro = 0.0;

      // Input low-pass filter (bandwidth)
      this._lp1 +=
        bw *
        (this._preDelay[
          (this._pDLength + this._pDWrite - pd + i) % this._pDLength
        ] -
          this._lp1);

      // Pre-tank diffusion (4 all-pass filters)
      let pre = this.writeDelay(0, this._lp1 - fi * this.readDelay(0));
      pre = this.writeDelay(
        1,
        fi * (pre - this.readDelay(1)) + this.readDelay(0)
      );
      pre = this.writeDelay(
        2,
        fi * pre + this.readDelay(1) - si * this.readDelay(2)
      );
      pre = this.writeDelay(
        3,
        si * (pre - this.readDelay(3)) + this.readDelay(2)
      );

      const split = si * pre + this.readDelay(3);

      // Modulated excursions for chorus effect
      const exc = ed * (1 + Math.cos(this._excPhase * 6.28));
      const exc2 = ed * (1 + Math.sin(this._excPhase * 6.2847));

      // Left loop (tank diffuse 1 -> long delay 1 -> damp 1 -> tank diffuse 2 -> long delay 2)
      let temp = this.writeDelay(
        4,
        split + dc * this.readDelay(11) + ft * this.readDelayCAt(4, exc)
      );
      this.writeDelay(5, this.readDelayCAt(4, exc) - ft * temp);
      this._lp2 += dp * (this.readDelay(5) - this._lp2);
      temp = this.writeDelay(6, dc * this._lp2 - st * this.readDelay(6));
      this.writeDelay(7, this.readDelay(6) + st * temp);

      // Right loop (tank diffuse 3 -> long delay 3 -> damp 2 -> tank diffuse 4 -> long delay 4)
      temp = this.writeDelay(
        8,
        split + dc * this.readDelay(7) + ft * this.readDelayCAt(8, exc2)
      );
      this.writeDelay(9, this.readDelayCAt(8, exc2) - ft * temp);
      this._lp3 += dp * (this.readDelay(9) - this._lp3);
      temp = this.writeDelay(10, dc * this._lp3 - st * this.readDelay(10));
      this.writeDelay(11, this.readDelay(10) + st * temp);

      // Left output: sum of taps from both loops
      lo =
        this.readDelayAt(9, this._taps[0]) +
        this.readDelayAt(9, this._taps[1]) -
        this.readDelayAt(10, this._taps[2]) +
        this.readDelayAt(11, this._taps[3]) -
        this.readDelayAt(5, this._taps[4]) -
        this.readDelayAt(6, this._taps[5]) -
        this.readDelayAt(7, this._taps[6]);

      // Right output: sum of taps from both loops
      ro =
        this.readDelayAt(5, this._taps[7]) +
        this.readDelayAt(5, this._taps[8]) -
        this.readDelayAt(6, this._taps[9]) +
        this.readDelayAt(7, this._taps[10]) -
        this.readDelayAt(9, this._taps[11]) -
        this.readDelayAt(10, this._taps[12]) -
        this.readDelayAt(11, this._taps[13]);

      outputs[0][0][i] += lo * we;
      outputs[0][1][i] += ro * we;

      this._excPhase += ex;

      i++;

      // Advance all delay line indices
      for (let j = 0; j < this._Delays.length; j++) {
        const d = this._Delays[j];
        d[1] = (d[1] + 1) & d[3];
        d[2] = (d[2] + 1) & d[3];
      }
    }

    // Update preDelay index
    this._pDWrite = (this._pDWrite + 128) % this._pDLength;

    return true;
  }
}

// @ts-ignore
registerProcessor("dattorro-reverb", DattorroReverbProcessor);
console.log("DattorroReverbProcessor registered");
