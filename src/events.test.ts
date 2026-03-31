import { AudioBuffer } from "standardized-audio-context-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Playback } from "./playback";
import { audioContextMock, cacophony } from "./setupTests";
import type { Sound } from "./sound";
import { Synth } from "./synth";
import { SynthPlayback } from "./synthPlayback";

beforeAll(() => {
  vi.useFakeTimers();
});

describe("Synth event system", () => {
  let synth: Synth;

  beforeEach(() => {
    synth = new Synth(audioContextMock, audioContextMock.createGain());
  });

  it("emits play event when synth is played", async () => {
    return new Promise<void>((resolve) => {
      synth.on("play", (playback) => {
        expect(playback).toBeInstanceOf(SynthPlayback);
        resolve();
      });
      synth.play();
    });
  });

  it("emits stop event when synth is stopped", () => {
    return new Promise<void>((resolve) => {
      synth.on("stop", () => {
        expect(synth.isPlaying).toBe(false);
        resolve();
      });
      synth.play();
      synth.stop();
    });
  });

  it("emits pause event when synth is paused", () => {
    return new Promise<void>((resolve) => {
      synth.on("pause", () => {
        expect(synth.isPlaying).toBe(false);
        resolve();
      });
      synth.play();
      synth.pause();
    });
  });

  it("emits frequencyChange event when frequency is changed", () => {
    return new Promise<void>((resolve) => {
      synth.on("frequencyChange", (freq) => {
        expect(freq).toBe(880);
        resolve();
      });
      synth.frequency = 880;
    });
  });

  it("emits detuneChange event when detune is changed", () => {
    return new Promise<void>((resolve) => {
      synth.on("detuneChange", (detune) => {
        expect(detune).toBe(100);
        resolve();
      });
      synth.detune = 100;
    });
  });

  it("emits typeChange event when oscillator type is changed", () => {
    return new Promise<void>((resolve) => {
      synth.on("typeChange", (type) => {
        expect(type).toBe("square");
        resolve();
      });
      synth.type = "square";
    });
  });

  it("can remove event listeners", () => {
    const listener = vi.fn();
    synth.on("play", listener);
    synth.off("play", listener);
    synth.play();
    expect(listener).not.toHaveBeenCalled();
  });

  it("handles multiple listeners for the same event", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    synth.on("play", listener1);
    synth.on("play", listener2);
    synth.play();
    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
  });
});

afterAll(() => {
  vi.useRealTimers();
});

describe("Cacophony event system", () => {
  it("emits mute event when muted", () => {
    const listener = vi.fn();
    cacophony.on("mute", listener);
    cacophony.volume = 0.5;
    cacophony.mute();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("emits unmute event when unmuted", () => {
    const listener = vi.fn();
    cacophony.volume = 0.5;
    cacophony.mute();
    cacophony.on("unmute", listener);
    cacophony.unmute();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("emits suspend event when paused", () => {
    const listener = vi.fn();
    cacophony.on("suspend", listener);
    cacophony.pause();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("emits resume event when resumed", () => {
    const listener = vi.fn();
    cacophony.on("resume", listener);
    cacophony.resume();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not emit mute when already muted", () => {
    const listener = vi.fn();
    cacophony.volume = 0.5;
    cacophony.mute();
    cacophony.on("mute", listener);
    cacophony.mute();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not emit unmute when not muted", () => {
    const listener = vi.fn();
    cacophony.on("unmute", listener);
    cacophony.unmute();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("Event system", () => {
  let sound: Sound;
  let buffer: AudioBuffer;

  beforeEach(async () => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    sound = await cacophony.createSound(buffer);
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

  it("emits resume event on sound when resuming from pause", () => {
    const listener = vi.fn();
    sound.on("resume", listener);
    sound.play();
    sound.pause();
    sound.resume();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("emits ended event on sound when playback ends naturally", () => {
    const listener = vi.fn();
    sound.on("ended", listener);
    const [playback] = sound.play();
    // Simulate natural end via loopEnded callback
    playback.loopEnded();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("emits loopEnd event on sound when a loop iteration completes", () => {
    const listener = vi.fn();
    sound.on("loopEnd", listener);
    const [playback] = sound.play();
    playback.loop(2);
    // Simulate first loop iteration ending
    playback.loopEnded();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("emits resume event on playback when resuming from pause", () => {
    const [playback] = sound.play();
    const listener = vi.fn();
    playback.on("resume", listener);
    playback.pause();
    playback.play();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not emit resume event on playback for initial play", () => {
    const [playback] = sound.preplay();
    const listener = vi.fn();
    playback.on("resume", listener);
    playback.play();
    expect(listener).not.toHaveBeenCalled();
  });

  it("emits ended event on playback when it ends naturally", () => {
    const [playback] = sound.play();
    const listener = vi.fn();
    playback.on("ended", listener);
    playback.loopEnded();
    expect(listener).toHaveBeenCalledOnce();
  });
});
