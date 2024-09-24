import { AudioContext } from "standardized-audio-context-mock";
import {
  beforeEach,
  describe,
  expect,
  it
} from "vitest";
import { Cacophony, SoundType } from "./cacophony";
import { Synth } from "./synth";
import { SynthPlayback } from "./synthPlayback";

let cacophony: Cacophony;
let audioContextMock: AudioContext;



describe("Synth class", () => {
  let synth: Synth;
  let audioContextMock: AudioContext;

  beforeEach(() => {
    audioContextMock = new AudioContext();
    synth = new Synth(audioContextMock, audioContextMock.createGain());
  });

  it("is created with correct default properties", () => {
    expect(synth.context).toBe(audioContextMock);
    expect(synth.soundType).toBe(SoundType.Oscillator);
    expect(synth.panType).toBe("HRTF");
    expect(synth.oscillatorOptions).toEqual({});
  });

  it("can create a playback", () => {
    const playbacks = synth.preplay();
    expect(playbacks.length).toBe(1);
    expect(playbacks[0]).toBeInstanceOf(SynthPlayback);
  });

  it("can play and stop a synth", () => {
    const playbacks = synth.play();
    expect(playbacks.length).toBe(1);
    expect(playbacks[0].isPlaying).toBe(true);
    synth.stop();
    expect(playbacks[0].isPlaying).toBe(false);
  });

  it("can set and get frequency", () => {
    synth.frequency = 880;
    expect(synth.frequency).toBe(880);
  });

  it("can set and get detune", () => {
    synth.detune = 100;
    expect(synth.detune).toBe(100);
  });

  it("can set and get oscillator type", () => {
    synth.type = "square";
    expect(synth.type).toBe("square");
  });

  it("can set oscillator options", () => {
    synth.oscillatorOptions = { frequency: 440, type: "sawtooth" };
    expect(synth.oscillatorOptions).toEqual({
      frequency: 440,
      type: "sawtooth",
    });
  });

  it("can clone itself", () => {
    synth.frequency = 660;
    synth.type = "triangle";
    const clone = synth.clone();
    expect(clone).toBeInstanceOf(Synth);
    expect(clone.frequency).toBe(660);
    expect(clone.type).toBe("triangle");
  });

  it("can add and remove filters", () => {
    const filter = audioContextMock.createBiquadFilter();
    synth.addFilter(filter);
    expect(synth.filters.length).toBe(1);
    synth.removeFilter(filter);
    expect(synth.filters.length).toBe(0);
  });

  it("applies filters to playbacks", () => {
    const filter = audioContextMock.createBiquadFilter();
    synth.addFilter(filter);
    const playbacks = synth.preplay();
    expect(playbacks[0].filters.length).toBe(1);
  });

  it("can set and get volume", () => {
    synth.volume = 0.5;
    expect(synth.volume).toBe(0.5);
  });

  it("can set and get position for 3D audio", () => {
    synth.position = [1, 2, 3];
    expect(synth.position).toEqual([1, 2, 3]);
  });

  it("can set and get stereo pan", () => {
    synth.panType = "stereo";
    synth.stereoPan = 0.5;
    expect(synth.stereoPan).toBe(0.5);
  });
});

