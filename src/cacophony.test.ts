import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { SoundType } from "./cacophony";
import { Group } from "./group";
import { audioContextMock, cacophony, mockCache } from "./setupTests";
import { Sound } from "./sound";

describe("Cacophony core", () => {
  test("Cacophony is created with the correct context", () => {
    expect(cacophony.context).toBe(audioContextMock);
  });

  test("that createSound creates a sound with the correct buffer", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = await cacophony.createSound(buffer);
    expect(sound.buffer).toBe(buffer);
  });

  test("that createSound creates a sound with the correct context", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = await cacophony.createSound(buffer);
    expect(sound.context).toBe(audioContextMock);
  });

  it("createOscillator creates an oscillator with default parameters when none are provided", () => {
    const synth = cacophony.createOscillator({});
    expect(synth.type).toBe("sine");
    expect(synth.frequency).toBe(440);
  });

  it("createOscillator creates an oscillator with the provided parameters", () => {
    const synth = cacophony.createOscillator({
      frequency: 880,
      type: "square",
    });
    expect(synth.type).toBe("square");
    expect(synth.frequency).toBe(880);
  });

  it("createGroup creates a Group instance with the provided Sound instances", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound1 = await cacophony.createSound(buffer);
    const sound2 = await cacophony.createSound(buffer);
    const group = await cacophony.createGroup([sound1, sound2]);
    expect(group.sounds.length).toBe(2);
    expect(group.sounds[0]).toBe(sound1);
    expect(group.sounds[1]).toBe(sound2);
  });

  it("createBiquadFilter creates a BiquadFilterNode with default parameters when none are provided", () => {
    const filter = cacophony.createBiquadFilter({});
    expect(filter.type).toBe("lowpass");
    expect(filter.frequency.value).toBe(350);
    expect(filter.gain.value).toBe(0);
    expect(filter.Q.value).toBe(1);
  });

  it("createBiquadFilter creates a BiquadFilterNode with the provided parameters", () => {
    const filter = cacophony.createBiquadFilter({
      type: "highpass",
      frequency: 5000,
      gain: 5,
      Q: 0.5,
    });
    expect(filter.type).toBe("highpass");
    expect(filter.frequency.value).toBe(5000);
    expect(filter.gain.value).toBe(5);
    expect(filter.Q.value).toBe(0.5);
  });

  describe("Global volume and muting", () => {
    it("sets and gets global volume correctly", () => {
      cacophony.volume = 0.5;
      expect(cacophony.volume).toBe(0.5);
      expect(cacophony.globalGainNode.gain.value).toBe(0.5);

      cacophony.volume = 0.75;
      expect(cacophony.volume).toBe(0.75);
      expect(cacophony.globalGainNode.gain.value).toBe(0.75);
    });

    it("mutes and unmutes correctly", () => {
      cacophony.volume = 0.8;
      expect(cacophony.muted).toBe(false);

      cacophony.mute();
      expect(cacophony.muted).toBe(true);
      expect(cacophony.volume).toBe(0);
      expect(cacophony.globalGainNode.gain.value).toBe(0);

      cacophony.unmute();
      expect(cacophony.muted).toBe(false);
      expect(cacophony.volume).toBe(0.8);
      expect(cacophony.globalGainNode.gain.value).toBe(0.8);
    });

    it("handles muted property correctly", () => {
      cacophony.volume = 0.6;

      cacophony.muted = true;
      expect(cacophony.muted).toBe(true);
      expect(cacophony.volume).toBe(0);
      expect(cacophony.globalGainNode.gain.value).toBe(0);

      cacophony.muted = false;
      expect(cacophony.muted).toBe(false);
      expect(cacophony.volume).toBe(0.6);
      expect(cacophony.globalGainNode.gain.value).toBe(0.6);
    });
  });
});

describe("Cacophony advanced features", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createStream creates a streaming Sound instance", async () => {
    const streamSound = await cacophony.createStream(
      "https://example.com/audio.mp3"
    );
    expect(streamSound).toBeInstanceOf(Sound);
    expect(streamSound.soundType).toBe(SoundType.Streaming);
  });

  it("createGroupFromUrls creates a Group with Sound instances", async () => {
    const urls = ["url1", "url2", "url3"];
    const mockBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    vi.mocked(mockCache.getAudioBuffer).mockResolvedValue(mockBuffer);
    const group = await cacophony.createGroupFromUrls(urls);
    expect(group).toBeInstanceOf(Group);
    expect(group.sounds.length).toBe(3);
    group.sounds.forEach((sound) => expect(sound).toBeInstanceOf(Sound));
  });

  it("clearMemoryCache calls cache.clearMemoryCache", () => {
    cacophony.clearMemoryCache();
    expect(mockCache.clearMemoryCache).toHaveBeenCalled();
  });

  it("sets and gets listener orientation correctly", () => {
    const orientation = {
      forward: [1, 0, 0],
      up: [0, 1, 0],
    };
    // Mock the listener properties
    cacophony.listener = {
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: 0 },
      upX: { value: 0 },
      upY: { value: 0 },
      upZ: { value: 0 },
    } as any;
    cacophony.listenerOrientation = orientation;
    expect(cacophony.listenerOrientation).toEqual(orientation);
  });

  it("throws an error when creating a sound with an invalid URL", async () => {
    vi.mocked(mockCache.getAudioBuffer).mockRejectedValueOnce(
      new Error("Invalid URL")
    );
    await expect(cacophony.createSound("invalid-url")).rejects.toThrow(
      "Invalid URL"
    );
  });

  it("pause and resume methods call context.suspend and context.resume", () => {
    const suspendSpy = vi.spyOn(cacophony.context, "suspend");
    const resumeSpy = vi.spyOn(cacophony.context, "resume");

    cacophony.pause();
    expect(suspendSpy).toHaveBeenCalled();

    cacophony.resume();
    expect(resumeSpy).toHaveBeenCalled();
  });

  it("setGlobalVolume sets the global gain node value", () => {
    cacophony.setGlobalVolume(0.5);
    expect(cacophony.globalGainNode.gain.value).toBe(0.5);
  });
});
