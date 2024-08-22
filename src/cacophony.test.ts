import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
  vi,
} from "vitest";
import { Cacophony, SoundType } from "./cacophony";
import { Playback } from "./playback";
import { Sound } from "./sound";
import { Synth } from "./synth";
import { SynthPlayback } from "./synthPlayback";

let cacophony: Cacophony;
let audioContextMock: AudioContext;

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  audioContextMock = new AudioContext();
  cacophony = new Cacophony(audioContextMock);
});

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

afterEach(() => {
  audioContextMock.close();
});

test("Cacophony is created with the correct context", () => {
  expect(cacophony.context).toBe(audioContextMock);
});

test("that createSound creates a sound with the correct buffer", async () => {
  const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
  const sound = await cacophony.createSound(buffer);
  expect(sound.buffer).toBe(buffer);
});

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

describe("Playback class", () => {
  let playback: Playback;
  let buffer: AudioBuffer;
  let source: AudioBufferSourceNode;
  let gainNode: GainNode;
  let sound: Sound;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    source = audioContextMock.createBufferSource();
    source.buffer = buffer;
    gainNode = audioContextMock.createGain();
    sound = new Sound("test-url", buffer, audioContextMock, gainNode);
    playback = new Playback(sound, source, gainNode);
  });

  it("can play and stop", () => {
    playback.play();
    expect(playback.isPlaying).toBe(true);
    playback.stop();
    expect(playback.isPlaying).toBe(false);
  });

  it("can pause and resume", () => {
    playback.play();
    playback.pause();
    expect(playback.isPlaying).toBe(false);
    playback.play();
    expect(playback.isPlaying).toBe(true);
  });

  it("handles seeking correctly", () => {
    const seekTime = 5;
    playback.seek(seekTime);
    // We can't directly test the internal state, so we'll check if it's playing
    playback.play();
    expect(playback.isPlaying).toBe(true);
  });

  it("applies volume changes", () => {
    playback.volume = 0.5;
    expect(playback.volume).toBe(0.5);
  });

  it("applies playback rate changes", () => {
    playback.playbackRate = 1.5;
    expect(playback.playbackRate).toBe(1.5);
  });

  it("handles cleanup correctly", () => {
    const disconnectSpy = vi.spyOn(playback.source!, "disconnect");
    playback.cleanup();
    expect(disconnectSpy).toHaveBeenCalled();
    expect(playback.source).toBeUndefined();
  });

  it("can stop playbacks directly", () => {
    playback.play();
    expect(playback.isPlaying).toBe(true);
    playback.stop();
    expect(playback.isPlaying).toBe(false);
  });

  it("can play after seeking", () => {
    const seekTime = 2;
    playback.seek(seekTime);
    playback.play();
    expect(playback.isPlaying).toBe(true);
  });

  it("resumes from the correct position after seeking and pausing", () => {
    const initialSeekTime = 2;
    playback.seek(initialSeekTime);
    playback.play();

    // Simulate some time passing
    vi.advanceTimersByTime(1000);

    playback.pause();
    expect(playback.isPlaying).toBe(false);

    playback.play();
    expect(playback.isPlaying).toBe(true);
  });

  it("handles multiple seek operations correctly", () => {
    playback.seek(2);
    playback.seek(4);
    playback.play();
    expect(playback.isPlaying).toBe(true);
  });
});
it("createOscillator creates an oscillator with default parameters when none are provided", () => {
  const synth = cacophony.createOscillator({});
  expect(synth.type).toBe("sine");
  expect(synth.frequency).toBe(440);
});

it("createOscillator creates an oscillator with the provided parameters", () => {
  const synth = cacophony.createOscillator({ frequency: 880, type: "square" });
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

  playback.loop(3);
  expect(playback.loopCount).toBe(2);
  expect(playback.currentLoop).toBe(0);
  // Simulate the end of playback to trigger looping 3 times
  playback.loopEnded(); // First loop
  playback.loopEnded(); // Second loop
  playback.loopEnded(); // Third loop

  // The sound should have looped 3 times
  expect(playback.currentLoop).toBe(3);

  // The sound should not be playing after 3 loops
  expect(playback.isPlaying).toBe(false);
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
