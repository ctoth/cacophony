import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { AudioBuffer, AudioBufferSourceNode } from "standardized-audio-context-mock";
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
    audioContextMock.createBufferSource = vi.fn().mockImplementation(() => {
      const newSource = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      return newSource;
    });
  });

  // ... [keep all other existing tests]

  it("resumes from pause position instead of restarting", () => {
    const startSpy = vi.spyOn(source, 'start');
    
    playback.play();
    expect(playback.isPlaying).toBe(true);
    
    // Simulate some time passing
    vi.advanceTimersByTime(2000);
    
    playback.pause();
    expect(playback.isPlaying).toBe(false);
    
    // Clear previous calls to createBufferSource
    (audioContextMock.createBufferSource as jest.Mock).mockClear();
    
    playback.play();
    expect(playback.isPlaying).toBe(true);
    
    // Check that createBufferSource was called when resuming
    expect(audioContextMock.createBufferSource).toHaveBeenCalledTimes(1);
    
    // Get the new source created when resuming
    const newSource = (audioContextMock.createBufferSource as jest.Mock).mock.results[0].value;
    
    // Check that start was called on the new source
    expect(newSource.start).toHaveBeenCalledTimes(1);
    
    // The first argument to start should be 0, the second should be the offset
    expect(newSource.start).toHaveBeenCalledWith(0, expect.any(Number));
    expect(newSource.start.mock.calls[0][1]).toBeGreaterThan(0);
  });
});
