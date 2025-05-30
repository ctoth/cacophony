import { vi, expect, describe, it, beforeEach, afterEach } from "vitest";
import {
  AudioBuffer,
  AudioBufferSourceNode,
} from "standardized-audio-context-mock";
import { Playback } from "./playback";
import { audioContextMock, cacophony } from "./setupTests";
import { Sound } from "./sound";

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

    // Mock createBufferSource to return a new source each time
    vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
      return {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn((when = 0, offset = 0) => {}),
        stop: vi.fn(),
        onended: null,
      };
    });
  });

  afterEach(() => {
    if (playback && playback.source) {
      playback.cleanup();
    }
    cacophony.clearMemoryCache();
    vi.restoreAllMocks();
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

  it("handles repeated play calls gracefully", () => {
    playback.play(); // First call to play
    expect(playback.isPlaying).toBe(true);

    playback.play(); // Second call without stopping
    // Should still be playing without throwing errors or re-initializing inappropriately 
    expect(playback.isPlaying).toBe(true);
  });

  it("stop right after play does not cause errors", () => {
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

  it("resumes from pause position instead of restarting", () => {
    const startSpy = vi.spyOn(source, "start");

    // Mock the context's currentTime
    let mockCurrentTime = 0;
    vi.spyOn(audioContextMock, "currentTime", "get").mockImplementation(
      () => mockCurrentTime
    );

    playback.play();
    expect(playback.isPlaying).toBe(true);

    // Simulate some time passing
    mockCurrentTime = 2;

    playback.pause();
    expect(playback.isPlaying).toBe(false);

    // Clear previous calls to createBufferSource
    vi.mocked(audioContextMock.createBufferSource).mockClear();

    playback.play();
    expect(playback.isPlaying).toBe(true);

    // Check that createBufferSource was called when resuming
    expect(audioContextMock.createBufferSource).toHaveBeenCalledTimes(1);

    // Get the new source created when resuming
    const newSource = vi.mocked(audioContextMock.createBufferSource).mock
      .results[0].value;

    // Check that start was called on the new source
    expect(newSource.start).toHaveBeenCalledTimes(1);

    // The first argument to start should be 0, the second should be the offset
    expect(newSource.start).toHaveBeenCalledWith(0, expect.any(Number));
    expect(newSource.start.mock.calls[0][1]).toBeGreaterThan(0);
  });
});

describe("Playback cloning", () => {
  let originalPlayback: Playback;
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
    originalPlayback = new Playback(sound, source, gainNode);

    originalPlayback.volume = 0.8;
    originalPlayback.playbackRate = 1.5;
    originalPlayback.loop(2);
    
    const filter = audioContextMock.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1000;
    originalPlayback.addFilter(filter as unknown as BiquadFilterNode);
  });

  afterEach(() => {
    if (originalPlayback && originalPlayback.source) {
      originalPlayback.cleanup();
    }
    cacophony.clearMemoryCache();
    vi.restoreAllMocks();
  });

  it("creates a clone with the same properties", () => {
    const clone = originalPlayback.clone();

    expect(clone).not.toBe(originalPlayback);
    expect(clone.volume).toBe(originalPlayback.volume);
    expect(clone.playbackRate).toBe(originalPlayback.playbackRate);
    expect(clone.loopCount).toBe(originalPlayback.loopCount);
    expect(clone.panType).toBe(originalPlayback.panType);
  });

  it("creates a clone with independent properties", () => {
    const clone = originalPlayback.clone();

    clone.volume = 0.5;
    clone.playbackRate = 2.0;
    clone.loop(3);

    expect(clone.volume).not.toBe(originalPlayback.volume);
    expect(clone.playbackRate).not.toBe(originalPlayback.playbackRate);
    expect(clone.loopCount).not.toBe(originalPlayback.loopCount);
  });

  it("creates a clone with overridden properties", () => {
    const clone = originalPlayback.clone({ loopCount: 5, panType: "HRTF" });

    expect(clone.loopCount).toBe(5);
    expect(clone.panType).toBe("HRTF");
    expect(clone.volume).toBe(originalPlayback.volume);
    expect(clone.playbackRate).toBe(originalPlayback.playbackRate);
  });

  it("clones filters correctly", () => {
    const clone = originalPlayback.clone();

    expect(clone['_filters'].length).toBe(originalPlayback['_filters'].length);
    expect(clone['_filters'][0].type).toBe(originalPlayback['_filters'][0].type);
    expect(clone['_filters'][0].frequency.value).toBe(originalPlayback['_filters'][0].frequency.value);
  });

  it("creates independent filters for the clone", () => {
    const clone = originalPlayback.clone();

    const newFilter = audioContextMock.createBiquadFilter();
    newFilter.type = "highpass";
    newFilter.frequency.value = 2000;
    clone.addFilter(newFilter as unknown as BiquadFilterNode);

    expect(clone['_filters'].length).toBe(2);
    expect(originalPlayback['_filters'].length).toBe(1);
  });
});

describe("Playback filters chain", () => {
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

  afterEach(() => {
    if (playback && playback.source) {
      playback.cleanup();
    }
    cacophony.clearMemoryCache();
    vi.restoreAllMocks();
  });

  it("connects multiple filters in order", () => {
    const filter1 = audioContextMock.createBiquadFilter();
    const filter2 = audioContextMock.createBiquadFilter();
    
    // Spy on refreshFilters method
    const refreshSpy = vi.spyOn(playback as any, 'refreshFilters');
    
    playback.addFilter(filter1);
    playback.addFilter(filter2);

    // Verify refreshFilters was called for each filter addition
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    
    // Verify filters are in the correct order in the array
    expect(playback['_filters'].length).toBe(2);
    expect(playback['_filters'][0].type).toBe(filter1.type);
    expect(playback['_filters'][1].type).toBe(filter2.type);
  });
});

describe("Playback error cases", () => {
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

  afterEach(() => {
    if (playback && playback.source) {
      playback.cleanup();
    }
    cacophony.clearMemoryCache();
    vi.restoreAllMocks();
  });

  it("throws an error when trying to play a cleaned-up sound", () => {
    playback.cleanup();
    expect(() => playback.play()).toThrow("Cannot play a sound that has been cleaned up");
  });

  it("throws an error when seeking to a negative time", () => {
    expect(() => playback.seek(-1)).toThrow("Invalid time value for seek");
  });

  it("throws an error when seeking to NaN", () => {
    expect(() => playback.seek(NaN)).toThrow("Invalid time value for seek");
  });
  
  it("throws an error when setting an invalid playback rate", () => {
    expect(() => { playback.playbackRate = 0; }).toThrow("Playback rate must be greater than 0");
    expect(() => { playback.playbackRate = -1; }).toThrow("Playback rate must be greater than 0");
  });

  it("throws an error when trying to clone a cleaned-up sound", () => {
    playback.cleanup();
    expect(() => playback.clone()).toThrow("Cannot clone a sound that has been cleaned up");
  });

  it("throws an error when trying to add a filter to a cleaned-up sound", () => {
    playback.cleanup();
    const filter = audioContextMock.createBiquadFilter();
    expect(() => playback.addFilter(filter as unknown as BiquadFilterNode)).toThrow("Cannot update filters on a sound that has been cleaned up");
  });

  it("throws an error when trying to remove a filter from a cleaned-up sound", () => {
    const filter = audioContextMock.createBiquadFilter();
    playback.addFilter(filter as unknown as BiquadFilterNode);
    playback.cleanup();
    expect(() => playback.removeFilter(filter as unknown as BiquadFilterNode)).toThrow("Cannot update filters on a sound that has been cleaned up");
  });
});

describe("Playback looping and seeking with AudioBufferSourceNode (Bug Catching)", () => {
  let playback: Playback;
  let buffer: AudioBuffer;
  let initialMockSource: AudioBufferSourceNode;
  let gainNode: GainNode;
  let sound: Sound;

  beforeEach(() => {
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    // Initial source created by Playback constructor
    initialMockSource = {
      buffer: buffer,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      playbackRate: { value: 1, setValueAtTime: vi.fn() } as any,
    } as unknown as AudioBufferSourceNode;

    // Spy on createBufferSource and control what it returns
    vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
      const newSource = {
        buffer: null, // Buffer will be assigned by Playback's recreateSource
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: { value: 1, setValueAtTime: vi.fn() } as any,
      } as unknown as AudioBufferSourceNode;
      return newSource;
    });

    // The first call to createBufferSource happens inside the Sound constructor if buffer is provided,
    // or preplay, then Playback constructor. For this test, we'll mock it to return our initialMockSource
    // for the very first creation, then subsequent calls will get new mocks.
    vi.mocked(audioContextMock.createBufferSource).mockReturnValueOnce(
      initialMockSource
    );

    gainNode = audioContextMock.createGain();
    sound = new Sound("test-url", buffer, audioContextMock, gainNode);
    // Pass the initialMockSource to the Playback constructor
    playback = new Playback(sound, initialMockSource, gainNode);
    // Now, clear the mock calls that happened during setup so we can test specific behaviors
    vi.mocked(audioContextMock.createBufferSource).mockClear();
    vi.mocked(initialMockSource.start).mockClear();
    vi.mocked(initialMockSource.stop).mockClear();
  });

  afterEach(() => {
    if (playback && playback.source) {
      playback.cleanup();
    }
    cacophony.clearMemoryCache();
    vi.restoreAllMocks();
  });

  it("looping recreates and starts a new AudioBufferSourceNode", () => {
    playback.loop(1); // Play twice in total
    playback.play();

    const firstSourceInstance = playback.source as any;
    expect(firstSourceInstance.start).toHaveBeenCalledTimes(1);
    expect(firstSourceInstance.start).toHaveBeenCalledWith(0, 0); // Starts from offset 0

    // Clear createBufferSource mock calls before triggering loop
    vi.mocked(audioContextMock.createBufferSource).mockClear();

    // Simulate the first playback ending
    if (playback.source && playback.source.onended) {
      playback.source.onended({} as Event); // Trigger loopEnded
    }

    expect(playback.isPlaying).toBe(true); // Should be playing the next loop
    // A new source should have been created for the loop
    expect(vi.mocked(audioContextMock.createBufferSource)).toHaveBeenCalledTimes(1);

    const secondSourceInstance = playback.source as any;
    expect(secondSourceInstance).not.toBe(firstSourceInstance);
    expect(secondSourceInstance.start).toHaveBeenCalledTimes(1);
    expect(secondSourceInstance.start).toHaveBeenCalledWith(0, 0); // Loop starts from offset 0

    // Ensure the original source's start method wasn't called again
    expect(firstSourceInstance.start).toHaveBeenCalledTimes(1);
    // Ensure the original source's stop method was called when it was paused/stopped during seek(0)
    expect(firstSourceInstance.stop).toHaveBeenCalledTimes(1);
  });

  it("seeking while playing recreates and starts a new AudioBufferSourceNode", () => {
    playback.play();
    const firstSourceInstance = playback.source as any;
    expect(firstSourceInstance.start).toHaveBeenCalledTimes(1);

    vi.mocked(audioContextMock.createBufferSource).mockClear();
    vi.mocked(firstSourceInstance.stop).mockClear();

    const seekTime = 0.5;
    playback.seek(seekTime); // Seek while playing

    expect(playback.isPlaying).toBe(true);
    // A new source should have been created due to seek while playing
    expect(vi.mocked(audioContextMock.createBufferSource)).toHaveBeenCalledTimes(1);

    const secondSourceInstance = playback.source as any;
    expect(secondSourceInstance).not.toBe(firstSourceInstance);
    expect(secondSourceInstance.start).toHaveBeenCalledTimes(1);
    // The second argument to start (offset) should be the seekTime
    expect(secondSourceInstance.start).toHaveBeenCalledWith(0, seekTime);


    // Original source should have been stopped, and its start not called again
    expect(firstSourceInstance.start).toHaveBeenCalledTimes(1);
    expect(firstSourceInstance.stop).toHaveBeenCalledTimes(1);
  });

  it("seeking while paused, then playing, recreates and starts a new AudioBufferSourceNode", () => {
    playback.play();
    const firstSourceInstance = playback.source as any;
    expect(firstSourceInstance.start).toHaveBeenCalledTimes(1);

    playback.pause(); // This calls source.stop()
    expect(firstSourceInstance.stop).toHaveBeenCalledTimes(1);

    vi.mocked(audioContextMock.createBufferSource).mockClear();
    vi.mocked(firstSourceInstance.start).mockClear(); // Clear start calls on the first instance

    const seekTime = 0.3;
    playback.seek(seekTime);

    // Seeking while paused should not immediately recreate the source
    expect(vi.mocked(audioContextMock.createBufferSource)).not.toHaveBeenCalled();
    // The source instance should still be the first one (though it's stopped)
    expect(playback.source).toBe(firstSourceInstance);

    playback.play(); // Resume playback

    expect(playback.isPlaying).toBe(true);
    // A new source should have been created on play() after pause+seek
    expect(vi.mocked(audioContextMock.createBufferSource)).toHaveBeenCalledTimes(1);

    const secondSourceInstance = playback.source as any;
    expect(secondSourceInstance).not.toBe(firstSourceInstance);
    expect(secondSourceInstance.start).toHaveBeenCalledTimes(1);
    expect(secondSourceInstance.start).toHaveBeenCalledWith(0, seekTime);

    // Original source's start should not have been called again
    expect(firstSourceInstance.start).not.toHaveBeenCalled();
  });
});
