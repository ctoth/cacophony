import { AudioBuffer } from "standardized-audio-context-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { audioContextMock, cacophony } from "./setupTests";

import { Group } from "./group";
import { Sound } from "./sound";

describe("Group class", () => {
  let group: Group;
  let sound1: Sound;
  let sound2: Sound;

  beforeEach(async () => {
    const buffer1 = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const buffer2 = new AudioBuffer({ length: 200, sampleRate: 44100 });
    sound1 = await cacophony.createSound(buffer1);
    sound2 = await cacophony.createSound(buffer2);
    group = new Group([sound1, sound2]);
  });

  it("can add and remove sounds from a group", () => {
    expect(group.sounds.length).toBe(2);
    
    const buffer3 = new AudioBuffer({ length: 300, sampleRate: 44100 });
    const sound3 = new Sound("test-url-3", buffer3, audioContextMock, audioContextMock.createGain());
    group.addSound(sound3);
    expect(group.sounds.length).toBe(3);
    expect(group.sounds).toContain(sound3);

    group.sounds.pop();
    expect(group.sounds.length).toBe(2);
    expect(group.sounds).not.toContain(sound3);
  });

  it("performs collective operations on grouped sounds", () => {
    const playSpy1 = vi.spyOn(sound1, 'play');
    const playSpy2 = vi.spyOn(sound2, 'play');
    const stopSpy1 = vi.spyOn(sound1, 'stop');
    const stopSpy2 = vi.spyOn(sound2, 'stop');

    group.play();
    expect(playSpy1).toHaveBeenCalled();
    expect(playSpy2).toHaveBeenCalled();

    group.stop();
    expect(stopSpy1).toHaveBeenCalled();
    expect(stopSpy2).toHaveBeenCalled();

    group.volume = 0.5;
    expect(sound1.volume).toBe(0.5);
    expect(sound2.volume).toBe(0.5);
  });

  it("plays sounds in order", () => {
    const preplaySpy1 = vi.spyOn(sound1, 'preplay');
    const preplaySpy2 = vi.spyOn(sound2, 'preplay');

    group.playOrdered();
    expect(preplaySpy1).toHaveBeenCalled();
    expect(preplaySpy2).not.toHaveBeenCalled();

    group.playOrdered();
    expect(preplaySpy2).toHaveBeenCalled();
  });

  it("plays random sounds", () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.7);
    const preplaySpy1 = vi.spyOn(sound1, 'preplay');
    const preplaySpy2 = vi.spyOn(sound2, 'preplay');

    group.playRandom();
    expect(randomSpy).toHaveBeenCalled();
    expect(preplaySpy2).toHaveBeenCalled();
    expect(preplaySpy1).not.toHaveBeenCalled();
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
});
