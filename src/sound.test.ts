import { AudioBuffer } from "standardized-audio-context-mock";
import { beforeEach, describe, expect, it, test, vi } from "vitest";
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
