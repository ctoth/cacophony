import type { FadeType, Position } from "./cacophony";
import type { BiquadFilterNode } from "./context";
import type { Synth } from "./synth";
import type { SynthPlayback } from "./synthPlayback";

export class SynthGroup {
  constructor(public synths: Synth[] = []) {}

  addSynth(synth: Synth) {
    this.synths.push(synth);
  }

  removeSynth(synth: Synth) {
    const index = this.synths.indexOf(synth);
    if (index !== -1) {
      this.synths.splice(index, 1);
    } else {
      throw new Error("Synth not found in group");
    }
  }

  play(): SynthPlayback[] {
    return this.synths.flatMap((synth) => synth.play());
  }

  stop(): void {
    this.synths.forEach((synth) => synth.stop());
  }

  pause(): void {
    this.synths.forEach((synth) => synth.pause());
  }

  resume(): void {
    this.synths.forEach((synth) => synth.resume());
  }

  get isPlaying(): boolean {
    return this.synths.some((synth) => synth.isPlaying);
  }

  addFilter(filter: BiquadFilterNode): void {
    this.synths.forEach((synth) => synth.addFilter(filter));
  }

  removeFilter(filter: BiquadFilterNode): void {
    this.synths.forEach((synth) => synth.removeFilter(filter));
  }

  fadeTo(value: number, duration: number, type?: FadeType): Promise<void> {
    return Promise.all(this.synths.map((synth) => synth.fadeTo(value, duration, type))).then(() => {});
  }

  fadeIn(duration: number, type?: FadeType): Promise<void> {
    return Promise.all(this.synths.map((synth) => synth.fadeIn(duration, type))).then(() => {});
  }

  fadeOut(duration: number, type?: FadeType): Promise<void> {
    return Promise.all(this.synths.map((synth) => synth.fadeOut(duration, type))).then(() => {});
  }

  stopWithFade(duration: number, type?: FadeType): Promise<void> {
    return Promise.all(this.synths.map((synth) => synth.stopWithFade(duration, type))).then(() => {});
  }

  get volume(): number {
    if (this.synths.length === 0) {
      return 1;
    }
    return this.synths.map((synth) => synth.volume).reduce((a, b) => a + b, 0) / this.synths.length;
  }

  set volume(volume: number) {
    this.synths.forEach((synth) => (synth.volume = volume));
  }

  get stereoPan(): number | null {
    if (this.synths.length === 0) {
      return null;
    }
    return this.synths[0].stereoPan;
  }

  set stereoPan(pan: number) {
    this.synths.forEach((synth) => (synth.stereoPan = pan));
  }

  get position(): Position {
    if (this.synths.length === 0) {
      return [0, 0, 0];
    }
    return this.synths[0].position;
  }

  set position(position: Position) {
    this.synths.forEach((synth) => (synth.position = position));
  }

  get frequency(): number {
    if (this.synths.length === 0) {
      return 440;
    }
    return this.synths[0].frequency;
  }

  set frequency(frequency: number) {
    this.synths.forEach((synth) => (synth.frequency = frequency));
  }

  get detune(): number {
    return this.synths[0]?.detune as number;
  }

  set detune(detune: number) {
    this.synths.forEach((synth) => (synth.detune = detune));
  }

  get type(): OscillatorType {
    if (this.synths.length === 0) {
      return "sine";
    }
    return this.synths[0].type;
  }

  set type(type: OscillatorType) {
    this.synths.forEach((synth) => (synth.type = type));
  }
}
