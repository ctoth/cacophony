import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioContextMock, cacophony } from "./setupTests";

import { Group } from "./group";
import { Playback } from "./playback";
import { Sound } from "./sound";

describe("Group class", () => {
  let group: Group;
  let sound1: Sound;
  let sound2: Sound;

  beforeEach(async () => {
    const buffer1 = new AudioBuffer({ length: 10, sampleRate: 44100 });
    const buffer2 = new AudioBuffer({ length: 20, sampleRate: 44100 });
    sound1 = await cacophony.createSound(buffer1);
    sound2 = await cacophony.createSound(buffer2);
    group = new Group([sound1, sound2]);
  });

  afterEach(() => {
    sound1 = sound2 = group = null;
    vi.restoreAllMocks();
  });

  it("can add and remove sounds from a group", () => {
    expect(group.sounds.length).toBe(2);

    const buffer3 = new AudioBuffer({ length: 30, sampleRate: 44100 });
    const sound3 = new Sound(
      "test-url-3",
      buffer3,
      audioContextMock,
      audioContextMock.createGain()
    );
    group.addSound(sound3);
    expect(group.sounds.length).toBe(3);
    expect(group.sounds).toContain(sound3);

    group.sounds.pop();
    expect(group.sounds.length).toBe(2);
    expect(group.sounds).not.toContain(sound3);
  });

  it("performs collective operations on grouped sounds", () => {
    const preplaySpy1 = vi
      .spyOn(sound1, "preplay")
      .mockReturnValue([{ play: vi.fn() } as unknown as Playback]);
    const preplaySpy2 = vi
      .spyOn(sound2, "preplay")
      .mockReturnValue([{ play: vi.fn() } as unknown as Playback]);

    group.play();
    expect(preplaySpy1).toHaveBeenCalled();
    expect(preplaySpy2).toHaveBeenCalled();

    const stopSpy1 = vi.spyOn(sound1, "stop");
    const stopSpy2 = vi.spyOn(sound2, "stop");

    group.stop();
    expect(stopSpy1).toHaveBeenCalled();
    expect(stopSpy2).toHaveBeenCalled();

    group.volume = 0.5;
    expect(sound1.volume).toBe(0.5);
    expect(sound2.volume).toBe(0.5);
  });

  it("plays sounds in order", () => {
    const preplaySpy1 = vi
      .spyOn(sound1, "preplay")
      .mockReturnValue([{ play: vi.fn() } as unknown as Playback]);
    const preplaySpy2 = vi
      .spyOn(sound2, "preplay")
      .mockReturnValue([{ play: vi.fn() } as unknown as Playback]);

    const playback1 = group.playOrdered();
    expect(preplaySpy1).toHaveBeenCalled();
    expect(preplaySpy2).not.toHaveBeenCalled();
    expect(playback1).toBeDefined();

    const playback2 = group.playOrdered();
    expect(preplaySpy2).toHaveBeenCalled();
    expect(playback2).toBeDefined();
  });

  it("plays random sounds", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.7);
    const preplaySpy1 = vi.spyOn(sound1, "preplay").mockReturnValue([]);
    const preplaySpy2 = vi
      .spyOn(sound2, "preplay")
      .mockReturnValue([{ play: vi.fn() } as unknown as Playback]);

    const playback = group.playRandom();
    expect(randomSpy).toHaveBeenCalled();
    expect(preplaySpy2).toHaveBeenCalled();
    expect(preplaySpy1).not.toHaveBeenCalled();
    expect(playback).toBeDefined();
  });

  it("handles looping correctly", () => {
    group.loop(2);
    expect(sound1.loopCount).toBe(2);
    expect(sound2.loopCount).toBe(2);

    group.loop("infinite");
    expect(sound1.loopCount).toBe("infinite");
    expect(sound2.loopCount).toBe("infinite");
  });

  it("manages playback state correctly", () => {
    const playbacks = group.play();
    expect(group.isPlaying).toBe(true);

    group.pause();
    expect(group.isPlaying).toBe(false);

    group.play();
    expect(group.isPlaying).toBe(true);

    group.stop();
    expect(group.isPlaying).toBe(false);
  });

  it("handles empty group gracefully", () => {
    const emptyGroup = new Group();
    expect(emptyGroup.playRandom()).toBeUndefined();
    expect(emptyGroup.playOrdered()).toBeUndefined();
    expect(emptyGroup.play()).toEqual([]);
  });
});
