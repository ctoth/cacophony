import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundType } from "./cacophony";
import { Playback } from "./playback";
import { audioContextMock, cacophony } from "./setupTests";
import { Sound } from "./sound";

describe("Media element play() rejection", () => {
  let sound: Sound;

  beforeEach(async () => {
    sound = await cacophony.createSound("https://example.com/audio.mp3");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setupHtmlSound = async (playImpl: ReturnType<typeof vi.fn>) => {
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const mediaElement = {
      src: "",
      crossOrigin: null,
      preload: "auto",
      error: null,
      load: vi.fn(() => {
        queueMicrotask(() => {
          const event = new Event("loadedmetadata");
          for (const listener of listeners.get("loadedmetadata") ?? []) {
            if (typeof listener === "function") {
              listener.call(mediaElement, event);
            } else {
              listener.handleEvent(event);
            }
          }
        });
      }),
      play: playImpl,
      pause: vi.fn(),
      currentTime: 0,
      duration: 10,
      loop: false,
      onended: null as (() => void) | null,
      playbackRate: 1,
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.set(type, listeners.get(type) ?? new Set());
        listeners.get(type)!.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.get(type)?.delete(listener);
      }),
    };

    vi.mocked(global.Audio).mockImplementationOnce(() => mediaElement as any);
    (audioContextMock as any).createMediaElementSource = vi.fn().mockImplementation(() => ({
      mediaElement,
      connect: vi.fn(),
      disconnect: vi.fn(),
    }));

    const htmlSound = await cacophony.createSound("https://example.com/html-audio.mp3", SoundType.HTML);
    return { htmlSound, mediaElement };
  };

  it("play() succeeds when mediaElement.play() resolves", () => {
    // Default createSound with URL uses buffer source — play is synchronous
    const playbacks = sound.play();
    expect(playbacks).toHaveLength(1);
    expect(playbacks[0].isPlaying).toBe(true);
  });

  describe("media element async play()", () => {
    type MockMediaElement = {
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
      duration: number;
      loop: boolean;
      onended: (() => void) | null;
      playbackRate: number;
    };
    let mediaElement: MockMediaElement;
    let playback: Playback;

    beforeEach(() => {
      mediaElement = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        currentTime: 0,
        duration: 10,
        loop: false,
        onended: null,
        playbackRate: 1,
      };
      const source = {
        mediaElement,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      const gainNode = audioContextMock.createGain();
      const bufferSound = new Sound("test-url", undefined, audioContextMock, gainNode);
      playback = new Playback(bufferSound, source as any, gainNode);
    });

    it("defers isPlaying until promise resolves", async () => {
      playback.play();
      expect(playback.isPlaying).toBe(false);

      await vi.waitFor(() => {
        expect(playback.isPlaying).toBe(true);
      });
    });

    it("emits play event only after promise resolves", async () => {
      const playSpy = vi.fn();
      playback.on("play", playSpy);

      playback.play();
      expect(playSpy).not.toHaveBeenCalled();

      await vi.waitFor(() => {
        expect(playSpy).toHaveBeenCalledWith(playback);
      });
    });

    it("on rejection: isPlaying stays false and error event is emitted", async () => {
      const rejectError = new DOMException("Autoplay blocked", "NotAllowedError");
      mediaElement.play.mockRejectedValue(rejectError);

      const errorSpy = vi.fn();
      playback.on("error", errorSpy);

      playback.play();
      expect(playback.isPlaying).toBe(false);

      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            error: rejectError,
            errorType: "source",
            recoverable: true,
          }),
        );
      });

      expect(playback.isPlaying).toBe(false);
    });

    it("on rejection from paused state: reverts to paused", async () => {
      // First, play successfully
      playback.play();
      await vi.waitFor(() => {
        expect(playback.isPlaying).toBe(true);
      });

      // Pause
      playback.pause();
      expect(playback.isPlaying).toBe(false);

      // Now make play reject
      const rejectError = new DOMException("Autoplay blocked", "NotAllowedError");
      mediaElement.play.mockRejectedValue(rejectError);

      const errorSpy = vi.fn();
      playback.on("error", errorSpy);

      playback.play();

      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalled();
      });

      expect(playback.isPlaying).toBe(false);
    });
  });

  it("emits sound play only after HTML playback is accepted, before globalPlay", async () => {
    const order: string[] = [];
    const { htmlSound } = await setupHtmlSound(vi.fn().mockResolvedValue(undefined));
    const soundPlaySpy = vi.fn(() => {
      order.push("sound:play");
    });

    htmlSound.on("play", soundPlaySpy);
    cacophony.on("globalPlay", () => {
      order.push("global:play");
    });

    const [playback] = htmlSound.play();

    expect(soundPlaySpy).not.toHaveBeenCalled();
    expect(order).toEqual([]);

    await vi.waitFor(() => {
      expect(soundPlaySpy).toHaveBeenCalledWith(playback);
      expect(order).toEqual(["sound:play", "global:play"]);
    });
  });

  it("does not emit sound play or globalPlay when HTML playback is rejected", async () => {
    const rejectError = new DOMException("Autoplay blocked", "NotAllowedError");
    const order: string[] = [];
    const soundPlaySpy = vi.fn(() => {
      order.push("sound:play");
    });
    const soundErrorSpy = vi.fn(() => {
      order.push("sound:error");
    });
    const { htmlSound } = await setupHtmlSound(vi.fn().mockRejectedValue(rejectError));

    htmlSound.on("play", soundPlaySpy);
    htmlSound.on("soundError", soundErrorSpy);
    cacophony.on("globalPlay", () => {
      order.push("global:play");
    });

    const [playback] = htmlSound.play();
    playback.on("error", () => {
      order.push("playback:error");
    });

    expect(order).toEqual([]);

    await vi.waitFor(() => {
      expect(soundErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://example.com/html-audio.mp3",
          error: rejectError,
          errorType: "playback",
          recoverable: true,
        }),
      );
    });

    expect(soundPlaySpy).not.toHaveBeenCalled();
    expect(order).toEqual(["playback:error", "sound:error"]);
  });

  it("cleanup() tears down active HTML playback", async () => {
    const mediaElement = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      currentTime: 0,
      duration: 10,
      loop: true,
      onended: null as (() => void) | null,
      playbackRate: 1,
    };
    const source = {
      mediaElement,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const gainNode = audioContextMock.createGain();
    const htmlSound = new Sound(
      "https://example.com/html-audio.mp3",
      undefined,
      audioContextMock,
      gainNode,
      SoundType.HTML,
    );
    const playback = new Playback(htmlSound, source as any, gainNode);
    htmlSound.playbacks.push(playback);

    playback.play();

    await vi.waitFor(() => {
      expect(playback.isPlaying).toBe(true);
    });

    htmlSound.cleanup();

    expect(mediaElement.pause).toHaveBeenCalledTimes(1);
    expect(mediaElement.currentTime).toBe(0);
    expect(mediaElement.loop).toBe(false);
    expect(mediaElement.onended).toBeNull();
    expect(playback.isPlaying).toBe(false);
    expect(playback.source).toBeUndefined();
    expect(htmlSound.playbacks).toHaveLength(0);
    expect(() => htmlSound.cleanup()).not.toThrow();
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
