import { rampAudioParam } from "./automation";
import type { AudioNode, BaseContext, BiquadFilterNode, GainNode } from "./context";

/** @internal A playback-owned stage, downstream of user effects and upstream of spatialization. */
export class Occlusion {
  readonly input: BiquadFilterNode;
  private readonly gain: GainNode;
  amount = 0;
  private startTime = 0;
  private endTime = 0;
  private startFrequency: number;
  private targetFrequency: number;
  private startGain = 1;
  private targetGain = 1;

  constructor(
    private readonly context: BaseContext,
    private output: AudioNode,
  ) {
    this.input = context.createBiquadFilter();
    this.gain = context.createGain();
    this.input.type = "lowpass";
    // Web Audio low-pass Q is in dB: 1/sqrt(2) gives a Butterworth response without a resonant peak.
    this.input.Q.value = 20 * Math.log10(Math.SQRT1_2);
    this.startFrequency = this.targetFrequency = context.sampleRate / 2;
    this.input.frequency.value = this.targetFrequency;
    this.gain.gain.value = 1;
    this.input.connect(this.gain);
    this.gain.connect(output);
  }

  setOutput(output: AudioNode): void {
    if (output === this.output) return;
    this.gain.disconnect(this.output);
    this.output = output;
    this.gain.connect(output);
  }

  setAmount(amount: number, duration: number): void {
    const now = this.context.currentTime;
    // Track the owned linear ramps explicitly. cancelScheduledValues removes a ramp's endpoint;
    // reading AudioParam.value after cancellation cannot reliably recover the interrupted value.
    const fraction = this.endTime <= now ? 1 : Math.max(0, (now - this.startTime) / (this.endTime - this.startTime));
    this.startFrequency += (this.targetFrequency - this.startFrequency) * fraction;
    this.startGain += (this.targetGain - this.startGain) * fraction;
    const nyquist = this.context.sampleRate / 2;
    this.targetFrequency = nyquist * (Math.min(800, nyquist) / nyquist) ** amount;
    this.targetGain = 10 ** ((-18 * amount) / 20);
    this.startTime = now;
    this.endTime = now + duration / 1000;
    this.input.frequency.cancelScheduledValues(now);
    this.gain.gain.cancelScheduledValues(now);
    rampAudioParam(this.input.frequency, this.targetFrequency, now, { duration, startValue: this.startFrequency });
    rampAudioParam(this.gain.gain, this.targetGain, now, { duration, startValue: this.startGain });
    this.amount = amount;
  }

  destroy(): void {
    const now = this.context.currentTime;
    this.input.frequency.cancelScheduledValues(now);
    this.gain.gain.cancelScheduledValues(now);
    this.input.disconnect();
    this.gain.disconnect();
  }
}
