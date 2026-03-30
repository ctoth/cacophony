import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "./group";
import type { Playback } from "./playback";
import { audioContextMock, cacophony } from "./setupTests";
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
    const sound3 = new Sound("test-url-3", buffer3, audioContextMock, audioContextMock.createGain());
    group.addSound(sound3);
    expect(group.sounds.length).toBe(3);
    expect(group.sounds).toContain(sound3);

    group.sounds.pop();
    expect(group.sounds.length).toBe(2);
    expect(group.sounds).not.toContain(sound3);
  });

  it("performs collective operations on grouped sounds", () => {
    const preplaySpy1 = vi.spyOn(sound1, "preplay").mockReturnValue([{ play: vi.fn() } as unknown as Playback]);
    const preplaySpy2 = vi.spyOn(sound2, "preplay").mockReturnValue([{ play: vi.fn() } as unknown as Playback]);

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
    const preplaySpy1 = vi.spyOn(sound1, "preplay").mockReturnValue([{ play: vi.fn() } as unknown as Playback]);
    const preplaySpy2 = vi.spyOn(sound2, "preplay").mockReturnValue([{ play: vi.fn() } as unknown as Playback]);

    const playback1 = group.playOrdered();
    expect(preplaySpy1).toHaveBeenCalled();
    expect(preplaySpy2).not.toHaveBeenCalled();
    expect(playback1).toBeDefined();

    const playback2 = group.playOrdered();
    expect(preplaySpy2).toHaveBeenCalled();
    expect(playback2).toBeDefined();
  });

  it("playOrdered(false) returns undefined after exhausting all sounds", () => {
    vi.spyOn(sound1, "preplay").mockReturnValue([{ play: vi.fn() } as unknown as Playback]);
    vi.spyOn(sound2, "preplay").mockReturnValue([{ play: vi.fn() } as unknown as Playback]);

    const playback1 = group.playOrdered(false);
    expect(playback1).toBeDefined();

    const playback2 = group.playOrdered(false);
    expect(playback2).toBeDefined();

    // All sounds exhausted — should return undefined, not crash
    const playback3 = group.playOrdered(false);
    expect(playback3).toBeUndefined();

    // Subsequent calls should also return undefined
    const playback4 = group.playOrdered(false);
    expect(playback4).toBeUndefined();
  });

  it("plays random sounds", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.7);
    const preplaySpy1 = vi.spyOn(sound1, "preplay").mockReturnValue([]);
    const preplaySpy2 = vi.spyOn(sound2, "preplay").mockReturnValue([{ play: vi.fn() } as unknown as Playback]);

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
    const _playbacks = group.play();
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

  it("returns volume of 1 for an empty group", () => {
    const emptyGroup = new Group();
    expect(emptyGroup.volume).toBe(1);
  });

  describe("Global events", () => {
    it("emits globalPlay when using Group.play()", () => {
      const globalPlayListener = vi.fn();
      cacophony.on("globalPlay", globalPlayListener);

      group.play();

      // Should emit globalPlay for each sound in the group
      expect(globalPlayListener).toHaveBeenCalledTimes(2);
      expect(globalPlayListener).toHaveBeenCalledWith({
        source: sound1,
        timestamp: expect.any(Number),
      });
      expect(globalPlayListener).toHaveBeenCalledWith({
        source: sound2,
        timestamp: expect.any(Number),
      });

      cacophony.off("globalPlay", globalPlayListener);
    });

    it("emits globalPlay when using Group.playOrdered()", () => {
      const globalPlayListener = vi.fn();
      cacophony.on("globalPlay", globalPlayListener);

      // Play first sound
      group.playOrdered();
      expect(globalPlayListener).toHaveBeenCalledTimes(1);
      expect(globalPlayListener).toHaveBeenCalledWith({
        source: sound1,
        timestamp: expect.any(Number),
      });

      // Play second sound
      group.playOrdered();
      expect(globalPlayListener).toHaveBeenCalledTimes(2);
      expect(globalPlayListener).toHaveBeenCalledWith({
        source: sound2,
        timestamp: expect.any(Number),
      });

      cacophony.off("globalPlay", globalPlayListener);
    });

    it("emits globalPlay when using Group.playRandom()", () => {
      const globalPlayListener = vi.fn();
      cacophony.on("globalPlay", globalPlayListener);

      // Mock random to always select the second sound
      vi.spyOn(Math, "random").mockReturnValue(0.7);

      group.playRandom();

      expect(globalPlayListener).toHaveBeenCalledTimes(1);
      expect(globalPlayListener).toHaveBeenCalledWith({
        source: sound2,
        timestamp: expect.any(Number),
      });

      cacophony.off("globalPlay", globalPlayListener);
    });

    it("emits globalStop when using Group.stop()", () => {
      const globalStopListener = vi.fn();
      cacophony.on("globalStop", globalStopListener);

      // First play the sounds
      group.play();

      // Then stop them
      group.stop();

      // Should emit globalStop for each sound in the group
      expect(globalStopListener).toHaveBeenCalledTimes(2);
      expect(globalStopListener).toHaveBeenCalledWith({
        source: sound1,
        timestamp: expect.any(Number),
      });
      expect(globalStopListener).toHaveBeenCalledWith({
        source: sound2,
        timestamp: expect.any(Number),
      });

      cacophony.off("globalStop", globalStopListener);
    });

    it("emits globalPause when using Group.pause()", () => {
      const globalPauseListener = vi.fn();
      cacophony.on("globalPause", globalPauseListener);

      // First play the sounds
      group.play();

      // Then pause them
      group.pause();

      // Should emit globalPause for each sound in the group
      expect(globalPauseListener).toHaveBeenCalledTimes(2);
      expect(globalPauseListener).toHaveBeenCalledWith({
        source: sound1,
        timestamp: expect.any(Number),
      });
      expect(globalPauseListener).toHaveBeenCalledWith({
        source: sound2,
        timestamp: expect.any(Number),
      });

      cacophony.off("globalPause", globalPauseListener);
    });
  });

  describe("Group filter operations", () => {
    it("addFilter propagates to all sounds in group", () => {
      const filter = audioContextMock.createBiquadFilter();

      group.addFilter(filter);

      // Verify filter was added to all sounds
      expect(sound1.filters.length).toBe(1);
      expect(sound1.filters[0]).toBe(filter);
      expect(sound2.filters.length).toBe(1);
      expect(sound2.filters[0]).toBe(filter);
    });

    it("removeFilter propagates to all sounds in group", () => {
      const filter = audioContextMock.createBiquadFilter();

      group.addFilter(filter);
      expect(sound1.filters.length).toBe(1);
      expect(sound2.filters.length).toBe(1);

      group.removeFilter(filter);

      // Verify filter was removed from all sounds
      expect(sound1.filters.length).toBe(0);
      expect(sound2.filters.length).toBe(0);
    });

    it("adding filter to group does not affect existing playbacks", () => {
      // Create playbacks from sounds
      const playback1 = sound1.preplay()[0];
      const playback2 = sound2.preplay()[0];

      expect(playback1.filters.length).toBe(0);
      expect(playback2.filters.length).toBe(0);

      // Add filter to group (which adds to sounds)
      const filter = audioContextMock.createBiquadFilter();
      group.addFilter(filter);

      // Existing playbacks should NOT get the filter
      expect(playback1.filters.length).toBe(0);
      expect(playback2.filters.length).toBe(0);

      // But new playbacks should get clones of the filter
      const playback3 = sound1.preplay()[0];
      expect(playback3.filters.length).toBe(1);
      expect(playback3.filters[0]).not.toBe(filter); // Clone, not same instance
    });
  });

  describe("Group fade delegation", () => {
    it("fadeTo delegates to all sounds", async () => {
      const fadeTo1 = vi.spyOn(sound1, "fadeTo").mockResolvedValue(undefined);
      const fadeTo2 = vi.spyOn(sound2, "fadeTo").mockResolvedValue(undefined);

      await group.fadeTo(0.5, 500);

      expect(fadeTo1).toHaveBeenCalledWith(0.5, 500, undefined);
      expect(fadeTo2).toHaveBeenCalledWith(0.5, 500, undefined);
    });

    it("fadeTo passes fade type through", async () => {
      const fadeTo1 = vi.spyOn(sound1, "fadeTo").mockResolvedValue(undefined);
      const fadeTo2 = vi.spyOn(sound2, "fadeTo").mockResolvedValue(undefined);

      await group.fadeTo(0.5, 500, "exponential");

      expect(fadeTo1).toHaveBeenCalledWith(0.5, 500, "exponential");
      expect(fadeTo2).toHaveBeenCalledWith(0.5, 500, "exponential");
    });

    it("fadeIn delegates to all sounds", async () => {
      const fadeIn1 = vi.spyOn(sound1, "fadeIn").mockResolvedValue(undefined);
      const fadeIn2 = vi.spyOn(sound2, "fadeIn").mockResolvedValue(undefined);

      await group.fadeIn(500);

      expect(fadeIn1).toHaveBeenCalledWith(500, undefined);
      expect(fadeIn2).toHaveBeenCalledWith(500, undefined);
    });

    it("fadeOut delegates to all sounds", async () => {
      const fadeOut1 = vi.spyOn(sound1, "fadeOut").mockResolvedValue(undefined);
      const fadeOut2 = vi.spyOn(sound2, "fadeOut").mockResolvedValue(undefined);

      await group.fadeOut(500);

      expect(fadeOut1).toHaveBeenCalledWith(500, undefined);
      expect(fadeOut2).toHaveBeenCalledWith(500, undefined);
    });

    it("stopWithFade delegates to all sounds", async () => {
      const stopWithFade1 = vi.spyOn(sound1, "stopWithFade").mockResolvedValue(undefined);
      const stopWithFade2 = vi.spyOn(sound2, "stopWithFade").mockResolvedValue(undefined);

      await group.stopWithFade(500);

      expect(stopWithFade1).toHaveBeenCalledWith(500, undefined);
      expect(stopWithFade2).toHaveBeenCalledWith(500, undefined);
    });
  });
});
