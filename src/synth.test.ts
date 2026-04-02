import { AudioContext } from "standardized-audio-context-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { SoundType } from "./cacophony";
import { Synth } from "./synth";
import { SynthPlayback } from "./synthPlayback";

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

  it("can pause and resume a synth without replacing the playback object", () => {
    synth = new Synth(audioContextMock, audioContextMock.createGain(), SoundType.Oscillator, "stereo", {
      frequency: 220,
      detune: 5,
      type: "triangle",
    });
    synth.volume = 0.4;
    synth.stereoPan = -0.25;

    const filter = audioContextMock.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 900;
    synth.addFilter(filter);

    const [playback] = synth.play();
    const originalSource = playback.source;

    synth.pause();
    synth.resume();

    expect(synth.playbacks).toHaveLength(1);
    expect(synth.playbacks[0]).toBe(playback);
    expect(playback.source).not.toBe(originalSource);
    expect(playback.isPlaying).toBe(true);
    expect(playback.frequency).toBe(220);
    expect(playback.detune).toBe(5);
    expect(playback.type).toBe("triangle");
    expect(playback.volume).toBe(0.4);
    expect(playback.stereoPan).toBe(-0.25);
    expect(playback.filters).toHaveLength(1);
    expect(playback.filters[0].type).toBe("highpass");
    expect(playback.filters[0].frequency.value).toBe(900);
  });

  it("applies synth and playback changes made while paused when resumed", () => {
    const filter = audioContextMock.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    synth.addFilter(filter);

    const [playback] = synth.play();

    synth.pause();
    synth.frequency = 550;
    synth.detune = -20;
    synth.type = "square";
    synth.volume = 0.6;
    synth.position = [4, 5, 6];
    playback.filters[0].Q.value = 7;

    synth.resume();

    expect(playback.isPlaying).toBe(true);
    expect(playback.frequency).toBe(550);
    expect(playback.detune).toBe(-20);
    expect(playback.type).toBe("square");
    expect(playback.volume).toBe(0.6);
    expect(playback.position).toEqual([4, 5, 6]);
    expect(playback.filters[0].Q.value).toBe(7);
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

  it("new playbacks get cloned filters from synth", () => {
    const filter = audioContextMock.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1000;

    synth.addFilter(filter);
    const playbacks = synth.preplay();

    expect(playbacks[0].filters.length).toBe(1);
    // Verify filter is a clone (same settings, different instance)
    expect(playbacks[0].filters[0]).not.toBe(filter);
    expect(playbacks[0].filters[0].type).toBe(filter.type);
    expect(playbacks[0].filters[0].frequency.value).toBe(filter.frequency.value);
  });

  it("prevents adding same filter instance twice", () => {
    const filter = audioContextMock.createBiquadFilter();
    synth.addFilter(filter);

    expect(() => synth.addFilter(filter)).toThrow("Cannot add the same filter instance twice");
  });

  it("throws error when removing non-existent filter", () => {
    const filter1 = audioContextMock.createBiquadFilter();
    const filter2 = audioContextMock.createBiquadFilter();

    synth.addFilter(filter1);

    expect(() => synth.removeFilter(filter2)).toThrow("Cannot remove filter that was never added to this container");
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

  describe("zero-value oscillator options", () => {
    it("applies detune of 0 via oscillatorOptions", () => {
      synth.oscillatorOptions = { detune: 0 };
      const playbacks = synth.play();
      expect(playbacks[0].source!.detune.value).toBe(0);
    });

    it("applies frequency of 0 via oscillatorOptions", () => {
      synth.oscillatorOptions = { frequency: 0 };
      const playbacks = synth.play();
      expect(playbacks[0].source!.frequency.value).toBe(0);
    });

    it("returns 0 from frequency getter when frequency is explicitly 0", () => {
      synth.oscillatorOptions = { frequency: 0 };
      expect(synth.frequency).toBe(0);
    });
  });
});
