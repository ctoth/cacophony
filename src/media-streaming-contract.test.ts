import { afterEach, describe, expect, it, vi } from "vitest";
import { cacophony } from "./setupTests";

type MockMediaElement = HTMLAudioElement & {
  load: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
};

function createMediaElement(options: { duration?: number; seekable?: boolean } = {}): MockMediaElement {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const duration = options.duration ?? 60;
  const seekable = options.seekable ?? true;
  const audio = {
    src: "",
    crossOrigin: null,
    preload: "auto",
    error: null,
    currentTime: 0,
    duration,
    loop: false,
    playbackRate: 1,
    onended: null as (() => void) | null,
    seekable: {
      length: seekable ? 1 : 0,
      start: () => 0,
      end: () => (Number.isFinite(duration) ? duration : 0),
    },
    load: vi.fn(() => {
      if (!audio.src) {
        return;
      }
      queueMicrotask(() => {
        const event = new Event("loadedmetadata");
        for (const listener of listeners.get("loadedmetadata") ?? []) {
          if (typeof listener === "function") {
            listener.call(audio, event);
          } else {
            listener.handleEvent(event);
          }
        }
      });
    }),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, listeners.get(type) ?? new Set());
      listeners.get(type)?.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener);
    }),
  };
  return audio as unknown as MockMediaElement;
}

function useMediaElements(...elements: MockMediaElement[]): void {
  for (const element of elements) {
    vi.mocked(global.Audio).mockImplementationOnce(function MockStreamingAudio() {
      return element;
    });
  }
}

async function createStreamingSound(entrypoint: "createSound" | "createStream", element: MockMediaElement) {
  useMediaElements(element);
  if (entrypoint === "createStream") {
    return cacophony.createStream("https://example.com/radio.mp3");
  }
  return cacophony.createSound("https://example.com/radio.mp3", "streaming");
}

describe("media-element streaming public contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    "createSound",
    "createStream",
  ] as const)("%s exposes the media tier's metadata-backed capabilities", async (entrypoint) => {
    const element = createMediaElement({ duration: 42, seekable: true });
    const sound = await createStreamingSound(entrypoint, element);

    expect(sound.streamCapabilities).toEqual({
      duration: 42,
      live: false,
      seekable: true,
      transport: "media-element",
    });
    expect(Number.isNaN(sound.duration)).toBe(true);

    const [playback] = sound.preplay();
    expect(playback.duration).toBe(42);
    expect(sound.duration).toBe(42);
    expect(() => sound.timeStretch(2)).toThrow(
      "Sound.timeStretch requires a buffer-based sound (a loaded AudioBuffer).",
    );
    sound.cleanup();
  });

  it("moves through play, pause, resume, and stop states with the documented events", async () => {
    const element = createMediaElement();
    const sound = await createStreamingSound("createSound", element);
    const soundEvents: string[] = [];
    const playbackEvents: string[] = [];
    sound.on("play", () => soundEvents.push("play"));
    sound.on("pause", () => soundEvents.push("pause"));
    sound.on("resume", () => soundEvents.push("resume"));
    sound.on("stop", () => soundEvents.push("stop"));

    const [playback] = sound.play();
    playback.on("play", () => playbackEvents.push("play"));
    playback.on("pause", () => playbackEvents.push("pause"));
    playback.on("resume", () => playbackEvents.push("resume"));
    playback.on("stop", () => playbackEvents.push("stop"));

    expect(playback.isPlaying).toBe(false);
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true));
    expect(soundEvents).toEqual(["play"]);
    expect(playbackEvents).toEqual(["play"]);

    sound.pause();
    expect(playback.isPaused).toBe(true);
    expect(soundEvents).toEqual(["play", "pause"]);
    expect(playbackEvents).toEqual(["play", "pause"]);

    sound.resume();
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true));
    expect(soundEvents).toEqual(["play", "pause", "resume"]);
    expect(playbackEvents).toEqual(["play", "pause", "play", "resume"]);

    sound.stop();
    expect(playback.isPlaying).toBe(false);
    expect(playback.source).toBeUndefined();
    expect(sound.playbacks).toEqual([]);
    expect(soundEvents).toEqual(["play", "pause", "resume", "stop"]);
    expect(playbackEvents).toEqual(["play", "pause", "play", "resume", "stop"]);
  });

  it("seeks media only when the browser exposes a seekable range", async () => {
    const finiteElement = createMediaElement({ duration: 90, seekable: true });
    const finiteSound = await createStreamingSound("createSound", finiteElement);
    finiteSound.preplay();

    finiteSound.seek(12.5);
    expect(finiteElement.currentTime).toBe(12.5);
    finiteSound.cleanup();

    const liveElement = createMediaElement({ duration: Number.POSITIVE_INFINITY, seekable: false });
    const liveSound = await createStreamingSound("createSound", liveElement);
    liveSound.preplay();

    expect(liveSound.streamCapabilities).toEqual({
      duration: Number.POSITIVE_INFINITY,
      live: true,
      seekable: false,
      transport: "media-element",
    });
    expect(liveSound.duration).toBe(Number.POSITIVE_INFINITY);
    expect(() => liveSound.seek(5)).toThrow("Live media-element streams do not expose a seekable range");
    expect(liveElement.currentTime).toBe(0);
    liveSound.cleanup();
  });

  it("applies infinite looping to every newly prepared media element", async () => {
    const firstElement = createMediaElement();
    const secondElement = createMediaElement();
    useMediaElements(firstElement, secondElement);
    const sound = await cacophony.createSound("https://example.com/loop.mp3", "streaming");

    sound.loop("infinite");
    sound.preplay();
    sound.preplay();

    expect(firstElement.loop).toBe(true);
    expect(secondElement.loop).toBe(true);
    sound.cleanup();
  });

  it("manages finite media loops and reports each repeated iteration", async () => {
    const element = createMediaElement();
    const sound = await createStreamingSound("createSound", element);
    const loopEnd = vi.fn();
    const ended = vi.fn();
    sound.on("loopEnd", loopEnd);
    sound.on("ended", ended);
    sound.loop(2);

    const [playback] = sound.play();
    await vi.waitFor(() => expect(playback.isPlaying).toBe(true));
    expect(element.loop).toBe(false);

    element.onended?.(new Event("ended"));
    await vi.waitFor(() => expect(loopEnd).toHaveBeenCalledTimes(1));
    element.onended?.(new Event("ended"));
    await vi.waitFor(() => expect(loopEnd).toHaveBeenCalledTimes(2));
    element.onended?.(new Event("ended"));

    await vi.waitFor(() => expect(ended).toHaveBeenCalledOnce());
    expect(playback.isPlaying).toBe(false);
    expect(sound.playbacks).toEqual([]);
  });

  it("creates an independent media element for every preplay call", async () => {
    const firstElement = createMediaElement();
    const secondElement = createMediaElement();
    useMediaElements(firstElement, secondElement);
    const sound = await cacophony.createSound("https://example.com/concurrent.mp3", "streaming");

    const [firstPlayback] = sound.preplay();
    const [secondPlayback] = sound.preplay();

    expect(firstPlayback).not.toBe(secondPlayback);
    expect(firstPlayback.source).not.toBe(secondPlayback.source);
    expect((firstPlayback.source as { mediaElement: HTMLMediaElement }).mediaElement).toBe(firstElement);
    expect((secondPlayback.source as { mediaElement: HTMLMediaElement }).mediaElement).toBe(secondElement);
    sound.cleanup();
  });

  it("pauses, clears, and reloads every media element during cleanup", async () => {
    const element = createMediaElement();
    const sound = await createStreamingSound("createSound", element);
    sound.preplay();

    sound.cleanup();

    expect(element.pause).toHaveBeenCalled();
    expect(element.src).toBe("");
    expect(element.load).toHaveBeenCalledTimes(2);
    expect(sound.playbacks).toEqual([]);
  });
});
