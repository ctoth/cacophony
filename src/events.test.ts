import { AudioBuffer } from "standardized-audio-context-mock";
import { beforeAll, afterAll, describe, expect, it, vi, beforeEach } from "vitest";
import { audioContextMock, mockCache } from "./setupTests";
import { Sound, Playback } from "./sound";
import { Cacophony } from "./cacophony";

let audioContextInstance: AudioContext;
let cacophonyInstance: Cacophony;

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  audioContextInstance = new AudioContext();
  cacophonyInstance = new Cacophony(audioContextInstance);
});

describe("Event system", () => {
  let sound: Sound;
  let buffer: AudioBuffer;

  beforeEach(async () => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    sound = await cacophonyInstance.createSound(buffer);
  });

  it("emits play event when sound is played", async () => {
    return new Promise<void>((resolve) => {
      sound.on("play", (playback) => {
        expect(playback).toBeInstanceOf(Playback);
        resolve();
      });
      sound.play();
    });
  });

  it("emits stop event when sound is stopped", () => {
    return new Promise<void>((resolve) => {
      sound.on("stop", () => {
        expect(sound.isPlaying).toBe(false);
        resolve();
      });
      sound.play();
      sound.stop();
    });
  });

  it("emits pause event when sound is paused", () => {
    return new Promise<void>((resolve) => {
      sound.on("pause", () => {
        expect(sound.isPlaying).toBe(false);
        resolve();
      });
      sound.play();
      sound.pause();
    });
  });

  it("emits volumeChange event when volume is changed", () => {
    return new Promise<void>((resolve) => {
      sound.on("volumeChange", (volume) => {
        expect(volume).toBe(0.5);
        resolve();
      });
      sound.volume = 0.5;
    });
  });

  it("emits rateChange event when playback rate is changed", () => {
    return new Promise<void>((resolve) => {
      sound.on("rateChange", (rate) => {
        expect(rate).toBe(1.5);
        resolve();
      });
      sound.playbackRate = 1.5;
    });
  });

  it("can remove event listeners", () => {
    const listener = vi.fn();
    sound.on("play", listener);
    sound.off("play", listener);
    sound.play();
    expect(listener).not.toHaveBeenCalled();
  });

  it("handles multiple listeners for the same event", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    sound.on("play", listener1);
    sound.on("play", listener2);
    sound.play();
    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });
});
