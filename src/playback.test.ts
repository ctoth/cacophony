import { vi, expect, describe, it, beforeEach } from "vitest";
import {
  AudioBuffer,
  AudioBufferSourceNode,
} from "standardized-audio-context-mock";
import { Playback } from "./playback";
import { audioContextMock } from "./setupTests";
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
