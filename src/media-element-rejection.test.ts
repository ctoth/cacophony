import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioContextMock, cacophony } from "./setupTests";
import type { Sound } from "./sound";

describe("Media element play() rejection", () => {
  let sound: Sound;

  beforeEach(async () => {
    sound = await cacophony.createSound("https://example.com/audio.mp3");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("play() succeeds when mediaElement.play() resolves", () => {
    // Default mock (from setupTests.ts) resolves — verify baseline works
    const playbacks = sound.play();
    expect(playbacks).toHaveLength(1);
    expect(playbacks[0].isPlaying).toBe(true);
  });

  it("play() throws when source.start() throws on buffer-backed sound", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const bufferSound = await cacophony.createSound(buffer);

    // Mock createBufferSource to return a node whose start() throws.
    // Playback.play() calls recreateSource() which calls context.createBufferSource().
    const originalCreate = audioContextMock.createBufferSource.bind(audioContextMock);
    vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
      const node = originalCreate();
      node.start = () => {
        throw new Error("NotAllowedError: play() failed");
      };
      return node;
    });

    expect(() => bufferSound.play()).toThrow("NotAllowedError: play() failed");
  });

  it("emits error event on playback when play() catches source error", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const bufferSound = await cacophony.createSound(buffer);

    // Get playback via preplay (this uses the real createBufferSource for construction)
    const playbacks = bufferSound.preplay();
    const playback = playbacks[0];

    const errorSpy = vi.fn();
    playback.on("error", errorSpy);

    // Now mock createBufferSource so recreateSource() inside play() gets a broken node
    const originalCreate = audioContextMock.createBufferSource.bind(audioContextMock);
    vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
      const node = originalCreate();
      node.start = () => {
        throw new Error("Autoplay blocked");
      };
      return node;
    });

    try {
      playback.play();
    } catch {
      // Expected to throw
    }

    // The error event is emitted asynchronously
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          errorType: "source",
          recoverable: true,
        }),
      );
    });
  });

  it("emits soundError on parent Sound when playback source errors", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const bufferSound = await cacophony.createSound(buffer);

    const soundErrorSpy = vi.fn();
    bufferSound.on("soundError", soundErrorSpy);

    // Get playback via preplay — this wires up error propagation from playback to sound
    const playbacks = bufferSound.preplay();
    const playback = playbacks[0];

    // Mock createBufferSource for the recreateSource call inside play()
    const originalCreate = audioContextMock.createBufferSource.bind(audioContextMock);
    vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
      const node = originalCreate();
      node.start = () => {
        throw new Error("Autoplay policy");
      };
      return node;
    });

    try {
      playback.play();
    } catch {
      // Expected
    }

    // soundError propagates asynchronously from playback error -> sound
    await vi.waitFor(() => {
      expect(soundErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.any(String),
          error: expect.any(Error),
          errorType: "playback",
          recoverable: true,
        }),
      );
    });
  });
});
