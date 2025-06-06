import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { audioContextMock, cacophony } from "./setupTests";

import { SoundType } from "./cacophony";
import { Sound } from "./sound";

describe("Sound playback and state management", () => {
  let sound: Sound;
  let buffer: AudioBuffer;

  beforeEach(async () => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    sound = await cacophony.createSound(buffer);
  });

  afterEach(() => {
    if (sound) {
      sound.stop();
    }
    cacophony.clearMemoryCache();
    vi.restoreAllMocks();
  });

  it("can play, stop, and play again", () => {
    const playbacks1 = sound.play();
    expect(sound.isPlaying).toBe(true);
    expect(playbacks1.length).toBe(1);
    expect(playbacks1[0].isPlaying).toBe(true);

    sound.stop();
    expect(sound.isPlaying).toBe(false);
    expect(playbacks1[0].isPlaying).toBe(false);

    const playbacks2 = sound.play();
    expect(sound.isPlaying).toBe(true);
    expect(playbacks2.length).toBe(1);
    expect(playbacks2[0].isPlaying).toBe(true);
    expect(playbacks2[0]).not.toBe(playbacks1[0]); // New playback instance
  });

  it("can pause and resume", () => {
    const playbacks = sound.play();
    expect(sound.isPlaying).toBe(true);

    sound.pause();
    expect(sound.isPlaying).toBe(false);
    expect(playbacks[0].isPlaying).toBe(false);

    const newPlaybacks = sound.play();
    expect(sound.isPlaying).toBe(true);
    expect(newPlaybacks[0].isPlaying).toBe(true);
  });

  it("stops all playbacks when sound is stopped", () => {
    const playbacks1 = sound.play();
    const playbacks2 = sound.play();
    expect(sound.playbacks.length).toBe(2);

    sound.stop();
    expect(sound.isPlaying).toBe(false);
    expect(playbacks1[0].isPlaying).toBe(false);
    expect(playbacks2[0].isPlaying).toBe(false);
  });

  it("manages multiple playbacks correctly", () => {
    const playbacks1 = sound.play();
    const playbacks2 = sound.play();
    expect(sound.playbacks.length).toBe(2);
    expect(sound.isPlaying).toBe(true);

    playbacks1[0].stop();
    expect(sound.isPlaying).toBe(true); // Still playing because of playbacks2
    expect(playbacks1[0].isPlaying).toBe(false);
    expect(playbacks2[0].isPlaying).toBe(true);

    playbacks2[0].stop();
    expect(sound.isPlaying).toBe(false); // All playbacks stopped
  });

  it("applies volume changes to all playbacks", () => {
    const playbacks1 = sound.play();
    const playbacks2 = sound.play();

    sound.volume = 0.5;
    expect(playbacks1[0].volume).toBe(0.5);
    expect(playbacks2[0].volume).toBe(0.5);
  });

  it("applies playback rate changes to all playbacks", () => {
    const playbacks1 = sound.play();
    const playbacks2 = sound.play();

    sound.playbackRate = 1.5;
    expect(playbacks1[0].playbackRate).toBe(1.5);
    expect(playbacks2[0].playbackRate).toBe(1.5);
  });

  it("handles looping correctly", () => {
    sound.loop(2);
    const playbacks = sound.play();
    expect(playbacks[0].loopCount).toBe(2);

    // Simulate loop completion
    vi.spyOn(playbacks[0], "loopEnded");
    playbacks[0].loopEnded();
    expect(playbacks[0].currentLoop).toBe(1);
    playbacks[0].loopEnded();
    expect(playbacks[0].currentLoop).toBe(2);
    playbacks[0].loopEnded();
    expect(playbacks[0].isPlaying).toBe(false);
  });
});

describe("Sound cloning", () => {
  let originalSound: Sound;
  let buffer: AudioBuffer;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    originalSound = new Sound(
      "test-url",
      buffer,
      audioContextMock,
      audioContextMock.createGain(),
      SoundType.Buffer,
      "HRTF"
    );
    originalSound.volume = 0.8;
    originalSound.playbackRate = 1.2;
    originalSound.position = [1, 2, 3];
    originalSound.loop(2);
    originalSound.addFilter(audioContextMock.createBiquadFilter());
  });

  afterEach(() => {
    if (originalSound) {
      originalSound.stop();
    }
    cacophony.clearMemoryCache();
    vi.restoreAllMocks();
  });

  it("clones a Sound instance with default settings", () => {
    const clonedSound = originalSound.clone();

    expect(clonedSound).not.toBe(originalSound);
    expect(clonedSound.url).toBe(originalSound.url);
    expect(clonedSound.buffer).toBe(originalSound.buffer);
    expect(clonedSound.context).toBe(originalSound.context);
    expect(clonedSound.soundType).toBe(originalSound.soundType);
    expect(clonedSound.panType).toBe(originalSound.panType);
    expect(clonedSound.volume).toBe(originalSound.volume);
    expect(clonedSound.playbackRate).toBe(originalSound.playbackRate);
    expect(clonedSound.position).toEqual(originalSound.position);
    expect(clonedSound.stereoPan).toBe(originalSound.stereoPan);
    expect(clonedSound.loopCount).toBe(originalSound.loopCount);
    expect(clonedSound.filters.length).toBe(originalSound.filters.length);
  });

  it("clones a Sound instance with overridden volume", () => {
    const clonedSound = originalSound.clone({ volume: 0.5 });

    expect(clonedSound.volume).toBe(0.5);
    expect(clonedSound.volume).not.toBe(originalSound.volume);
  });

  it("clones a Sound instance with overridden playbackRate", () => {
    const clonedSound = originalSound.clone({ playbackRate: 1.5 });

    expect(clonedSound.playbackRate).toBe(1.5);
    expect(clonedSound.playbackRate).not.toBe(originalSound.playbackRate);
  });

  it("clones a Sound instance with overridden position", () => {
    const clonedSound = originalSound.clone({ position: [4, 5, 6] });

    expect(clonedSound.position).toEqual([4, 5, 6]);
    expect(clonedSound.position).not.toEqual(originalSound.position);
  });

  it("clones a Sound instance with overridden stereoPan", () => {
    const clonedSound = originalSound.clone({
      panType: "stereo",
      stereoPan: -0.5,
    });

    expect(clonedSound.stereoPan).toBe(-0.5);
    expect(clonedSound.stereoPan).not.toBe(originalSound.stereoPan);
  });

  it("clones a Sound instance with overridden loopCount", () => {
    const clonedSound = originalSound.clone({ loopCount: "infinite" });

    expect(clonedSound.loopCount).toBe("infinite");
    expect(clonedSound.loopCount).not.toBe(originalSound.loopCount);
  });

  it("clones a Sound instance with overridden panType", () => {
    const clonedSound = originalSound.clone({ panType: "stereo" });

    expect(clonedSound.panType).toBe("stereo");
    expect(clonedSound.panType).not.toBe(originalSound.panType);
  });

  it("clones a Sound instance with overridden filters", () => {
    const newFilter = audioContextMock.createBiquadFilter();
    const clonedSound = originalSound.clone({ filters: [newFilter] });

    expect(clonedSound.filters.length).toBe(1);
    expect(clonedSound.filters[0]).toBe(newFilter);
    expect(clonedSound.filters).not.toEqual(originalSound.filters);
  });

  it("clones a Sound instance with multiple overrides", () => {
    const clonedSound = originalSound.clone({
      volume: 0.3,
      playbackRate: 0.8,
      stereoPan: 0.2,
      loopCount: 5,
      panType: "stereo",
    });

    expect(clonedSound.volume).toBe(0.3);
    expect(clonedSound.playbackRate).toBe(0.8);
    expect(clonedSound.stereoPan).toBe(0.2);
    expect(clonedSound.loopCount).toBe(5);
    expect(clonedSound.panType).toBe("stereo");
  });
});

describe("Sound class", () => {
  let sound: Sound;
  let buffer: AudioBuffer;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    sound = new Sound(
      "test-url",
      buffer,
      audioContextMock,
      audioContextMock.createGain()
    );
  });

  afterEach(() => {
    if (sound) {
      sound.stop();
    }
    cacophony.clearMemoryCache();
    vi.restoreAllMocks();
  });

  it("is created with correct properties", () => {
    expect(sound.url).toBe("test-url");
    expect(sound.buffer).toBe(buffer);
    expect(sound.context).toBe(audioContextMock);
    expect(sound.soundType).toBe(SoundType.Buffer);
    expect(sound.panType).toBe("HRTF");
  });

  it("can play and stop a sound", async () => {
    const playbacks = sound.play();
    expect(playbacks.length).toBeGreaterThan(0);
    expect(playbacks[0].isPlaying).toBe(true);
    sound.stop();
    expect(playbacks[0].isPlaying).toBe(false);
  });

  it("can pause and resume a sound", async () => {
    const playbacks = sound.play();
    sound.pause();
    expect(playbacks[0].isPlaying).toBe(false);
    sound.playbacks[0].play();
    expect(playbacks[0].isPlaying).toBe(true);
  });

  it("can set and get volume", () => {
    sound.volume = 0.5;
    expect(sound.volume).toBe(0.5);
  });

  it("can set and get playbackRate", () => {
    sound.playbackRate = 0.75;
    expect(sound.playbackRate).toBe(0.75);
  });

  it("can add and remove filters", () => {
    const filter = audioContextMock.createBiquadFilter();
    sound.addFilter(filter);
    expect(sound.filters.length).toBe(1);
    sound.removeFilter(filter);
    expect(sound.filters.length).toBe(0);
  });

  test("A sound loops the correct number of times", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = new Sound(
      "test-url",
      buffer,
      audioContextMock,
      audioContextMock.createGain()
    );
    const playbacks = sound.play();
    const playback = playbacks[0];
    expect(playback.isPlaying).toBe(true);

    // Set loop count to 2 (play 3 times in total)
    playback.loop(2);
    expect(playback.loopCount).toBe(2);
    expect(playback.currentLoop).toBe(0);

    // Simulate the end of playback to trigger looping
    playback.loopEnded(); // First play (currentLoop becomes 1)
    expect(playback.isPlaying).toBe(true);
    expect(playback.currentLoop).toBe(1);

    playback.loopEnded(); // Second play (currentLoop becomes 2)
    expect(playback.isPlaying).toBe(true);
    expect(playback.currentLoop).toBe(2);

    playback.loopEnded(); // Third play (should stop now)
    expect(playback.isPlaying).toBe(false);
    expect(playback.currentLoop).toBe(3);

    // Test with loop count 0 (play once, don't loop)
    playback.loop(0);
    playback.play();
    expect(playback.isPlaying).toBe(true);
    playback.loopEnded();
    expect(playback.isPlaying).toBe(false);
    expect(playback.currentLoop).toBe(1);
  });

  it("can stop an infinitely-looped sound", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = new Sound(
      "test-url",
      buffer,
      audioContextMock,
      audioContextMock.createGain()
    );
    const playbacks = sound.play();
    const playback = playbacks[0];

    // Set the sound to loop infinitely
    playback.loop("infinite");
    expect(playback.loopCount).toBe("infinite");
    expect(playback.isPlaying).toBe(true);

    // Stop the playback
    playback.stop();

    // Ensure the playback is stopped
    expect(playback.isPlaying).toBe(false);
  });

  it("can transition a looping sound to non-looping and vice versa", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = new Sound(
      "test-url",
      buffer,
      audioContextMock,
      audioContextMock.createGain()
    );
    const playbacks = sound.play();
    const playback = playbacks[0];

    // Set the sound to loop infinitely
    playback.loop("infinite");
    expect(playback.loopCount).toBe("infinite");

    // Simulate the end of playback
    playback.loopEnded();
    expect(playback.isPlaying).toBe(true);

    // Change to non-looping
    playback.loop(0);

    // Simulate the end of playback
    playback.loopEnded();
    expect(playback.currentLoop).toBe(1);
    expect(playback.isPlaying).toBe(false);

    // Set back to looping
    playback.loop(2);
    expect(playback.loopCount).toBe(2);

    // Play again and simulate two loop cycles
    playback.play();
    playback.loopEnded(); // First loop
    expect(playback.isPlaying).toBe(true);
    playback.loopEnded(); // Second loop
    expect(playback.isPlaying).toBe(true);
    playback.loopEnded(); // Should stop after second loop
    expect(playback.isPlaying).toBe(false);
  });

  it("can safely stop a sound twice, then play it, and stop it again", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = new Sound(
      "test-url",
      buffer,
      audioContextMock,
      audioContextMock.createGain()
    );
    // Create and stop the sound twice
    sound.play();
    sound.stop();
    sound.stop();
    // Ensure the sound is not playing
    expect(sound.isPlaying).toBe(false);
    // Play the sound again
    sound.play();
    // Ensure the sound is playing
    expect(sound.isPlaying).toBe(true);
    // Stop the sound
    sound.stop();
    // Ensure the sound is not playing
    expect(sound.isPlaying).toBe(false);
  });
  it("ensures isPlaying is set to false after a sound ends naturally", async () => {
    const buffer = new AudioBuffer({ length: 1, sampleRate: 44100 });
    const sound = new Sound(
      "test-url",
      buffer,
      audioContextMock,
      audioContextMock.createGain()
    );
    const playbacks = sound.play();
    const playback = playbacks[0];
    expect(playback.isPlaying).toBe(true);

    // Simulate the end of playback
    playback.loopEnded();

    // The sound should not be playing after it ends
    expect(playback.isPlaying).toBe(false);
  });
});
