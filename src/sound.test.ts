import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { audioContextMock, cacophony, mockCache } from "./setupTests";

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

describe("Loading Events", () => {
  let mockCallbacks: any;

  beforeEach(() => {
    mockCallbacks = {
      onLoadingStart: vi.fn(),
      onLoadingProgress: vi.fn(),
      onLoadingComplete: vi.fn(),
      onLoadingError: vi.fn(),
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cacophony.clearMemoryCache();
  });

  it("should emit loading start event when beginning to load audio", async () => {

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      headers: new Map(),
    });

    const audioContextDecodeAudioData = vi.fn().mockResolvedValue(
      new AudioBuffer({ length: 100, sampleRate: 44100 })
    );
    audioContextMock.decodeAudioData = audioContextDecodeAudioData;

    cacophony.on('loadingStart', mockCallbacks.onLoadingStart);
    await cacophony.createSound("test-url.mp3");

    expect(mockCallbacks.onLoadingStart).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "test-url.mp3",
        timestamp: expect.any(Number),
      })
    );
  });

  it("should emit loading progress events during fetch with progress info", async () => {
    const mockReadableStream = {
      getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new Uint8Array(512),
          })
          .mockResolvedValueOnce({
            done: false, 
            value: new Uint8Array(512),
          })
          .mockResolvedValueOnce({
            done: true,
            value: undefined,
          }),
      }),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: mockReadableStream,
      headers: new Map([['content-length', '1024']]),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
    });

    const audioContextDecodeAudioData = vi.fn().mockResolvedValue(
      new AudioBuffer({ length: 100, sampleRate: 44100 })
    );
    audioContextMock.decodeAudioData = audioContextDecodeAudioData;

    cacophony.on('loadingProgress', mockCallbacks.onLoadingProgress);
    await cacophony.createSound("test-url.mp3");

    expect(mockCallbacks.onLoadingProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "test-url.mp3",
        loaded: expect.any(Number),
        total: 1024,
        progress: expect.any(Number),
        timestamp: expect.any(Number),
      })
    );
  });

  it("should emit loading complete event on successful load", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      headers: new Map(),
    });

    const audioContextDecodeAudioData = vi.fn().mockResolvedValue(buffer);
    audioContextMock.decodeAudioData = audioContextDecodeAudioData;

    cacophony.on('loadingComplete', mockCallbacks.onLoadingComplete);
    await cacophony.createSound("test-url.mp3");

    expect(mockCallbacks.onLoadingComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "test-url.mp3",
        duration: expect.any(Number),
        size: 1024,
        timestamp: expect.any(Number),
      })
    );
  });

  it("should emit loading error event on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    cacophony.on('loadingError', mockCallbacks.onLoadingError);
    await expect(
      cacophony.createSound("test-url.mp3")
    ).rejects.toThrow("Network error");

    expect(mockCallbacks.onLoadingError).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "test-url.mp3",
        error: expect.any(Error),
        errorType: "network",
        timestamp: expect.any(Number),
      })
    );
  });

  it("should emit loading error event on decode failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      headers: new Map(),
    });

    const audioContextDecodeAudioData = vi.fn().mockRejectedValue(
      new Error("Invalid audio format")
    );
    audioContextMock.decodeAudioData = audioContextDecodeAudioData;

    cacophony.on('loadingError', mockCallbacks.onLoadingError);
    await expect(
      cacophony.createSound("test-url.mp3")
    ).rejects.toThrow("Invalid audio format");

    expect(mockCallbacks.onLoadingError).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "test-url.mp3",
        error: expect.any(Error),
        errorType: "decode",
        timestamp: expect.any(Number),
      })
    );
  });

  it("should emit loading error event on abort", async () => {
    const controller = new AbortController();
    
    global.fetch = vi.fn().mockImplementation(() => {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    });

    setTimeout(() => controller.abort(), 10);

    cacophony.on('loadingError', mockCallbacks.onLoadingError);
    await expect(
      cacophony.createSound("test-url.mp3", undefined, undefined, controller.signal)
    ).rejects.toThrow("Aborted");

    expect(mockCallbacks.onLoadingError).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "test-url.mp3",
        error: expect.any(DOMException),
        errorType: "abort",
        timestamp: expect.any(Number),
      })
    );
  });
});

describe("Sound Error Events", () => {
  let sound: Sound;
  let buffer: AudioBuffer;
  let mockCallbacks: any;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    sound = new Sound("test-url", buffer, audioContextMock, audioContextMock.createGain());

    mockCallbacks = {
      onSoundError: vi.fn(),
      onError: vi.fn(),
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (sound) {
      sound.stop();
    }
    cacophony.clearMemoryCache();
  });

  it("should emit soundError event on sound loading failures", async () => {
    const loadError = new Error("Failed to load sound");

    sound.on('soundError', mockCallbacks.onSoundError);

    // Simulate load error
    sound.emit('soundError', {
      url: "test-url",
      error: loadError,
      errorType: 'load',
      timestamp: Date.now(),
      recoverable: false,
    });

    expect(mockCallbacks.onSoundError).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "test-url",
        error: loadError,
        errorType: 'load',
        timestamp: expect.any(Number),
        recoverable: false,
      })
    );
  });

  it("should emit soundError event on playback initialization failures", async () => {
    const playbackError = new Error("Failed to initialize playback");

    sound.on('soundError', mockCallbacks.onSoundError);

    // Simulate playback error
    sound.emit('soundError', {
      url: "test-url",
      error: playbackError,
      errorType: 'playback',
      timestamp: Date.now(),
      recoverable: true,
    });

    expect(mockCallbacks.onSoundError).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "test-url",
        error: playbackError,
        errorType: 'playback',
        timestamp: expect.any(Number),
        recoverable: true,
      })
    );
  });

  it("should emit soundError event on context-related failures", async () => {
    const contextError = new Error("AudioContext is not available");

    sound.on('soundError', mockCallbacks.onSoundError);

    // Simulate context error
    sound.emit('soundError', {
      error: contextError,
      errorType: 'context',
      timestamp: Date.now(),
      recoverable: false,
    });

    expect(mockCallbacks.onSoundError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: contextError,
        errorType: 'context',
        timestamp: expect.any(Number),
        recoverable: false,
      })
    );
  });

  it("should emit soundError event on unknown sound failures", async () => {
    const unknownError = new Error("Unknown sound error");

    sound.on('soundError', mockCallbacks.onSoundError);

    // Simulate unknown error
    sound.emit('soundError', {
      url: "test-url",
      error: unknownError,
      errorType: 'unknown',
      timestamp: Date.now(),
      recoverable: true,
    });

    expect(mockCallbacks.onSoundError).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "test-url",
        error: unknownError,
        errorType: 'unknown',
        timestamp: expect.any(Number),
        recoverable: true,
      })
    );
  });

  it("should propagate playback errors as sound errors", async () => {
    const playbacks = sound.play();
    const playback = playbacks[0];
    const playbackError = new Error("Playback source failed");

    sound.on('soundError', mockCallbacks.onSoundError);

    // Simulate playback error propagating to sound
    playback.emit('error', {
      error: playbackError,
      errorType: 'source',
      timestamp: Date.now(),
      recoverable: true,
    });

    // Should trigger soundError with playback errorType
    expect(mockCallbacks.onSoundError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: playbackError,
        errorType: 'playback',
        recoverable: true,
      })
    );
  });

  it("should handle error event inheritance from BaseAudioEvents", async () => {
    const baseError = new Error("Base audio error");

    sound.on('error', mockCallbacks.onError);

    // Emit base error event
    sound.emit('error', {
      error: baseError,
      errorType: 'context',
      timestamp: Date.now(),
      recoverable: false,
    });

    expect(mockCallbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: baseError,
        errorType: 'context',
        timestamp: expect.any(Number),
        recoverable: false,
      })
    );
  });

  it("should handle multiple error event listeners", async () => {
    const mockCallback2 = vi.fn();
    const testError = new Error("Test sound error");

    sound.on('soundError', mockCallbacks.onSoundError);
    sound.on('soundError', mockCallback2);

    // Emit error
    sound.emit('soundError', {
      url: "test-url",
      error: testError,
      errorType: 'load',
      timestamp: Date.now(),
      recoverable: false,
    });

    expect(mockCallbacks.onSoundError).toHaveBeenCalledTimes(1);
    expect(mockCallback2).toHaveBeenCalledTimes(1);

    // Both should receive the same error event
    expect(mockCallbacks.onSoundError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: testError,
        errorType: 'load',
      })
    );
    expect(mockCallback2).toHaveBeenCalledWith(
      expect.objectContaining({
        error: testError,
        errorType: 'load',
      })
    );
  });
});
