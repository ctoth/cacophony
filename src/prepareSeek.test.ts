import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaElementSourceNode } from "./context";
import { Playback } from "./playback";
import { audioContextMock } from "./setupTests";
import { Sound } from "./sound";

class Media extends EventTarget {
  duration = Number.NaN;
  readyState = 0;
  seeking = false;
  paused = true;
  currentTime = 0;
  ranges: Array<[number, number]> = [];
  seekable: Pick<TimeRanges, "length" | "start" | "end">;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  error = null;
  onended = null;
  src = "test.wav";
  loop = false;
  playbackRate = 1;
  constructor() {
    super();
    const media = this;
    this.seekable = {
      get length() {
        return media.ranges.length;
      },
      start: (i: number) => media.ranges[i][0],
      end: (i: number) => media.ranges[i][1],
    };
  }
  ready() {
    this.duration = 10;
    this.readyState = 2;
    this.ranges = [[0, 10]];
    this.dispatchEvent(new Event("loadedmetadata"));
  }
}
const voices: Playback[] = [];
function makeVoice(media?: Media) {
  const gain = audioContextMock.createGain();
  const buffer = new AudioBuffer({ length: 441_000, sampleRate: 44_100 });
  const sound = new Sound("test.wav", media ? undefined : buffer, audioContextMock, gain);
  const source = media
    ? ({
        mediaElement: media as unknown as HTMLMediaElement,
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as MediaElementSourceNode)
    : audioContextMock.createBufferSource();
  if ("buffer" in source) source.buffer = buffer;
  const voice = new Playback(sound, source, gain);
  voices.push(voice);
  return voice;
}
afterEach(() => {
  for (const voice of voices.splice(0)) voice.cleanup();
  vi.useRealTimers();
});

describe("Playback.prepareSeek", () => {
  it.each([
    0,
    -1,
    Number.NaN,
    Infinity,
    2_147_483_648,
  ])("rejects invalid timeout %s before mutating media", async (timeoutMs) => {
    const media = new Media();
    media.ready();
    await expect(makeVoice(media).prepareSeek(2, { timeoutMs })).rejects.toBeInstanceOf(RangeError);
    expect(media.currentTime).toBe(0);
  });

  it("waits for metadata and seeked without playing or committing early", async () => {
    const media = new Media();
    const voice = makeVoice(media);
    const resolved = vi.fn();
    const preparing = voice.prepareSeek(3).then(resolved);
    expect(media.currentTime).toBe(0);
    media.ready();
    await Promise.resolve();
    expect(media.currentTime).toBe(3);
    expect(voice.currentTime).toBe(0);
    expect(resolved).not.toHaveBeenCalled();
    media.dispatchEvent(new Event("seeked"));
    await preparing;
    expect(voice.currentTime).toBe(3);
    expect(voice.state).toBe("unplayed");
    expect(media.play).not.toHaveBeenCalled();
  });

  it("accepts zero without waiting for an unnecessary seeked event", async () => {
    const media = new Media();
    media.ready();
    await makeVoice(media).prepareSeek(0);
    expect(media.play).not.toHaveBeenCalled();
  });

  it("waits for target seekability and data after seeking completes", async () => {
    const media = new Media();
    media.ready();
    media.ranges = [[0, 2]];
    const voice = makeVoice(media);
    const resolved = vi.fn();
    const pending = voice.prepareSeek(3).then(resolved);
    expect(media.currentTime).toBe(0);
    media.ranges = [[0, 10]];
    media.dispatchEvent(new Event("progress"));
    expect(media.currentTime).toBe(3);
    media.readyState = 1;
    media.dispatchEvent(new Event("seeked"));
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    media.readyState = 2;
    media.dispatchEvent(new Event("loadeddata"));
    await pending;
    expect(voice.currentTime).toBe(3);
  });

  it("allows the initial resource reset, but rejects reset after a seek request", async () => {
    const media = new Media();
    const voice = makeVoice(media);
    const pending = voice.prepareSeek(3);
    media.dispatchEvent(new Event("emptied"));
    media.ready();
    expect(media.currentTime).toBe(3);
    media.dispatchEvent(new Event("emptied"));
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    expect(voice.currentTime).toBe(0);
  });

  it("retains paused state and the prepared position when explicitly resumed", async () => {
    const media = new Media();
    media.ready();
    const voice = makeVoice(media);
    voice.play();
    await Promise.resolve();
    voice.pause();
    const pending = voice.prepareSeek(3);
    media.dispatchEvent(new Event("seeked"));
    await pending;
    expect(voice.state).toBe("paused");
    expect(media.paused).toBe(true);
    expect(media.play).toHaveBeenCalledTimes(1);
    voice.play();
    await Promise.resolve();
    expect(voice.state).toBe("playing");
    expect(media.currentTime).toBe(3);
  });

  it("propagates media failure without committing offset", async () => {
    const media = new Media();
    const voice = makeVoice(media);
    const pending = voice.prepareSeek(3);
    media.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toThrow("Media failed");
    expect(voice.currentTime).toBe(0);
  });

  it("does not mutate for an already aborted signal", async () => {
    const media = new Media();
    media.ready();
    const controller = new AbortController();
    controller.abort();
    await expect(makeVoice(media).prepareSeek(4, { signal: controller.signal })).rejects.toHaveProperty(
      "name",
      "AbortError",
    );
    expect(media.currentTime).toBe(0);
  });

  it("aborts cleanly and ignores stale browser events", async () => {
    const media = new Media();
    media.ready();
    const voice = makeVoice(media);
    const controller = new AbortController();
    const pending = voice.prepareSeek(4, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    media.dispatchEvent(new Event("seeked"));
    expect(voice.currentTime).toBe(0);
    expect(media.play).not.toHaveBeenCalled();
  });

  it.each(["stop", "cleanup", "play", "seek"] as const)("%s cancels preparation", async (operation) => {
    const media = new Media();
    const voice = makeVoice(media);
    const pending = voice.prepareSeek(4);
    if (operation === "seek") voice.seek(1);
    else voice[operation]();
    await expect(pending).rejects.toHaveProperty("name", "AbortError");
    media.ready();
    media.dispatchEvent(new Event("seeked"));
    expect(voice.currentTime).not.toBe(4);
  });

  it("supersedes pending preparation and only commits the newer target", async () => {
    const media = new Media();
    const voice = makeVoice(media);
    const first = voice.prepareSeek(4);
    const second = voice.prepareSeek(6);
    await expect(first).rejects.toHaveProperty("name", "AbortError");
    media.ready();
    media.dispatchEvent(new Event("seeked"));
    await second;
    expect(voice.currentTime).toBe(6);
  });

  it("bounds unseekable waits and removes readiness listeners", async () => {
    vi.useFakeTimers();
    const media = new Media();
    media.ready();
    media.ranges = [];
    const remove = vi.spyOn(media, "removeEventListener");
    const voice = makeVoice(media);
    const pending = voice.prepareSeek(3, { timeoutMs: 10 });
    const rejected = expect(pending).rejects.toHaveProperty("name", "TimeoutError");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(remove.mock.calls.length).toBeGreaterThanOrEqual(8);
    media.ready();
    expect(media.currentTime).toBe(0);
  });

  it("rejects live media and out of duration targets", async () => {
    const media = new Media();
    media.ready();
    media.duration = Infinity;
    await expect(makeVoice(media).prepareSeek(0)).rejects.toHaveProperty("name", "NotSupportedError");
    media.duration = 10;
    await expect(makeVoice(media).prepareSeek(11)).rejects.toBeInstanceOf(RangeError);
  });

  it("prepares buffer offsets without starting a source", async () => {
    const voice = makeVoice();
    await voice.prepareSeek(2);
    expect(voice.currentTime).toBe(2);
    expect(voice.state).toBe("unplayed");
    await expect(voice.prepareSeek(-1)).rejects.toBeInstanceOf(RangeError);
    await expect(voice.prepareSeek(11)).rejects.toBeInstanceOf(RangeError);
  });
});
