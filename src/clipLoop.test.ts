import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioBufferSourceNode } from "./context";
import type { Playback } from "./playback";
import { audioContextMock } from "./setupTests";
import { Sound } from "./sound";

const voices: Playback[] = [];
let clock = 0;
beforeEach(() => {
  clock = 0;
  vi.spyOn(audioContextMock, "currentTime", "get").mockImplementation(() => clock);
  vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(
    () =>
      ({
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }) as unknown as ReturnType<typeof audioContextMock.createBufferSource>,
  );
});
afterEach(() => {
  for (const voice of voices.splice(0)) voice.cleanup();
  vi.restoreAllMocks();
});
function make(region?: { start: number; duration: number }) {
  const buffer = new AudioBuffer({ length: 48_000 * 4, sampleRate: 48_000 });
  const sound = new Sound(
    "clip.wav",
    buffer,
    audioContextMock,
    audioContextMock.createGain(),
    "buffer",
    "stereo",
    undefined,
    undefined,
    undefined,
    region,
  );
  const [voice] = sound.preplay();
  voices.push(voice);
  return { voice, sound };
}
const sourceOf = (voice: Playback) => voice.source as AudioBufferSourceNode;
const endedOf = (voice: Playback) => {
  const ended = sourceOf(voice).onended;
  if (!ended) throw new Error("A started buffer must own its end callback");
  return () => ended(new Event("ended"));
};

describe("native clip bounds", () => {
  it("accepts a one-sample region despite floating point subtraction at a nonzero origin", () => {
    const { voice } = make();
    expect(() => voice.setLoopRegion(2, 2 + 1 / 48000)).not.toThrow();
  });
  it("bounds a nonlooping pass at R and exposes the actual buffer capability", () => {
    const { voice, sound } = make();
    expect(voice.supportsClipLoop).toBe(true);
    expect(sound.supportsClipLoop).toBe(true);
    voice.setLoopRegion(1, 2);
    voice.seek(0.5);
    voice.play({ at: 1 });
    expect(sourceOf(voice).start).toHaveBeenCalledWith(1, 0.5, 1.5);
    expect(sourceOf(voice).loop).toBe(false);
    voice.cleanup();
    expect(voice.supportsClipLoop).toBe(false);
  });
  it("translates sprite-relative loop points exactly once and preserves them across resume", () => {
    const { voice } = make({ start: 1, duration: 2 });
    voice.setLoopRegion(0.5, 1.5);
    voice.loop("infinite");
    voice.seek(0.25);
    voice.play();
    expect(sourceOf(voice).start).toHaveBeenCalledWith(0, 1.25);
    expect(sourceOf(voice)).toMatchObject({ loop: true, loopStart: 1.5, loopEnd: 2.5 });
    clock = 1.5;
    expect(voice.currentTime).toBeCloseTo(0.75);
    voice.pause();
    voice.play();
    expect(sourceOf(voice).start).toHaveBeenCalledWith(0, 1.75);
    expect(sourceOf(voice)).toMatchObject({ loopStart: 1.5, loopEnd: 2.5 });
  });
  it.each([
    [NaN, 2],
    [-1, 2],
    [2, 2],
    [1, 5],
    [1, 1 + 1 / 96000],
  ])("rejects invalid bounds %s..%s without changing native state", (start, end) => {
    const { voice } = make();
    const source = sourceOf(voice);
    expect(() => voice.setLoopRegion(start, end)).toThrow(RangeError);
    expect(sourceOf(voice)).toBe(source);
    expect(source.start).not.toHaveBeenCalled();
  });
  it("rejects offsets at/past R before changing state, including pending buffer preparation", async () => {
    const { voice } = make();
    voice.setLoopRegion(1, 2);
    voice.loop("infinite");
    voice.play();
    const source = voice.source;
    expect(() => voice.seek(2)).toThrow();
    expect(voice.source).toBe(source);
    expect(voice.state).toBe("playing");
    voice.pause();
    await expect(voice.prepareSeek(2)).rejects.toThrow();
    expect(voice.currentTime).toBe(0);
  });
  it("folds the same cursor through getter, rate changes and pause", () => {
    const { voice } = make();
    voice.setLoopRegion(1, 2);
    voice.loop("infinite");
    voice.seek(0.5);
    voice.play({ at: 1 });
    clock = 3;
    expect(voice.currentTime).toBeCloseTo(1.5);
    voice.playbackRate = 2;
    clock = 3.4;
    expect(voice.currentTime).toBeCloseTo(1.3);
    voice.pause();
    expect(voice.currentTime).toBeCloseTo(1.3);
    voice.play();
    expect(sourceOf(voice).start).toHaveBeenCalledWith(0, expect.closeTo(1.3));
  });
  it("also folds ordinary native whole-buffer infinite loops", () => {
    const { voice } = make();
    voice.loop("infinite");
    voice.play();
    clock = 9;
    expect(voice.currentTime).toBeCloseTo(1);
    voice.playbackRate = 2;
    clock = 9.5;
    expect(voice.currentTime).toBeCloseTo(2);
    voice.pause();
    expect(voice.currentTime).toBeCloseTo(2);
  });
  it("recreates bounded loop mode switches at the folded position and preserves future anchors", () => {
    const { voice } = make();
    voice.setLoopRegion(1, 2);
    voice.seek(0.5);
    voice.play({ at: 5 });
    const first = sourceOf(voice),
      staleEnd = endedOf(voice);
    clock = 2;
    voice.loop("infinite");
    expect(first.stop).toHaveBeenCalled();
    expect(sourceOf(voice).start).toHaveBeenCalledWith(5, 0.5);
    expect(sourceOf(voice).loop).toBe(true);
    staleEnd();
    expect(voice.state).toBe("playing");
    clock = 7;
    voice.loop(0);
    expect(sourceOf(voice).start).toHaveBeenCalledWith(7, 1.5, 0.5);
    expect(sourceOf(voice).loop).toBe(false);
  });
  it("preflights rejected loop broadcasts before changing the Sound or any other voice", () => {
    const { voice, sound } = make();
    const [other] = sound.preplay();
    voices.push(other);
    voice.setLoopRegion(1, 2);
    expect(() => sound.loop(2)).toThrow();
    expect(sound.loopCount).toBe(0);
    expect(other.loopCount).toBe(0);
    expect(voice.loopCount).toBe(0);
  });
  it.each([
    { loopCount: 2 },
    { fadeIn: 50, fadeInPerLoop: true },
    { fadeInPerLoop: true },
  ])("rejects play options atomically before changing volume, rate, source or cursor: %j", (invalid) => {
    const { voice } = make();
    voice.setLoopRegion(1, 2);
    voice.seek(0.5);
    const original = {
      source: voice.source,
      volume: voice.volume,
      rate: voice.playbackRate,
      time: voice.currentTime,
      state: voice.state,
      pan: voice.stereoPan,
    };
    expect(() => voice.play({ volume: 0.2, playbackRate: 2, stereoPan: 0.5, ...invalid })).toThrow();
    expect({
      source: voice.source,
      volume: voice.volume,
      rate: voice.playbackRate,
      time: voice.currentTime,
      state: voice.state,
      pan: voice.stereoPan,
    }).toEqual(original);
    expect(sourceOf(voice).start).not.toHaveBeenCalled();
    expect(sourceOf(voice).stop).not.toHaveBeenCalled();
  });
});

describe("owned absolute buffer end", () => {
  it("preflights mixed fade-out play options without changing an armed deadline or voice", () => {
    const { voice } = make();
    voice.setLoopRegion(1, 2);
    voice.loop("infinite");
    voice.play();
    voice.scheduleStop(5);
    const source = sourceOf(voice),
      volume = voice.volume,
      rate = voice.playbackRate;
    expect(() => voice.play({ volume: 0.2, playbackRate: 2, fadeOut: 50 })).toThrow();
    expect(() => voice.configureFadeOut(50)).toThrow();
    expect(voice.source).toBe(source);
    expect(voice.volume).toBe(volume);
    expect(voice.playbackRate).toBe(rate);
    expect(source.stop).toHaveBeenCalledExactlyOnceWith(5);
    const observer = vi.fn();
    voice.on("ended", observer);
    endedOf(voice)();
    expect(observer).toHaveBeenCalledOnce();
    expect(voice.state).toBe("stopped");
  });
  it("accepts an end before a future onset and terminates once without looping or stale restart", () => {
    const { voice, sound } = make();
    voice.setLoopRegion(1, 2);
    voice.loop("infinite");
    voice.play({ at: 5 });
    const source = sourceOf(voice),
      ended = endedOf(voice),
      observer = vi.fn();
    voice.on("ended", observer);
    voice.scheduleStop(4);
    expect(source.stop).toHaveBeenCalledWith(4);
    ended();
    ended();
    expect(observer).toHaveBeenCalledOnce();
    expect(voice.state).toBe("stopped");
    expect(sound.playbacks).not.toContain(voice);
    expect(audioContextMock.createBufferSource).toHaveBeenCalledTimes(2);
  });
  it("keeps deadlines absolute under rate changes, replaces them and clamps a past stop to now", () => {
    const { voice } = make();
    voice.play();
    voice.scheduleStop(5);
    voice.playbackRate = 2;
    expect(sourceOf(voice).stop).toHaveBeenCalledTimes(1);
    voice.scheduleStop(6);
    expect(sourceOf(voice).stop).toHaveBeenLastCalledWith(6);
    clock = 2;
    voice.scheduleStop(1);
    expect(sourceOf(voice).stop).toHaveBeenLastCalledWith(2);
  });
  it("does not arm an unstarted source, legacy numeric repeats, or incompatible terminal fades", () => {
    const { voice } = make();
    expect(() => voice.scheduleStop(1)).toThrow();
    expect(sourceOf(voice).stop).not.toHaveBeenCalled();
    voice.loop(2);
    voice.play();
    expect(() => voice.scheduleStop(2)).toThrow();
    voice.stop();
    voice.loop(0);
    voice.play();
    voice.configureFadeOut(100);
    expect(() => voice.scheduleStop(2)).toThrow();
  });
  it("revokes old end ownership on pause/seek/resume and preserves a new source after ended observer reentrancy", () => {
    const { voice } = make();
    voice.setLoopRegion(1, 2);
    voice.loop("infinite");
    voice.play();
    voice.scheduleStop(5);
    const stale = endedOf(voice);
    voice.pause();
    voice.seek(1.25);
    voice.play();
    const resumed = voice.source;
    stale();
    expect(voice.source).toBe(resumed);
    expect(voice.state).toBe("playing");
    voice.scheduleStop(7);
    const terminal = endedOf(voice);
    voice.on("ended", () => voice.seek(1.5));
    terminal();
    expect(voice.state).toBe("playing");
    expect(voice.source).not.toBe(resumed);
    expect(sourceOf(voice).stop).not.toHaveBeenCalled();
  });
  it("rejects clone allocation while armed, then copies independent bounds and folded position when unarmed", () => {
    const { voice } = make();
    voice.setLoopRegion(1, 2);
    voice.loop("infinite");
    voice.play();
    voice.scheduleStop(5);
    const count = vi.mocked(audioContextMock.createBufferSource).mock.calls.length;
    expect(() => voice.clone()).toThrow();
    expect(audioContextMock.createBufferSource).toHaveBeenCalledTimes(count);
    voice.pause();
    voice.play();
    clock = 2.5;
    const clone = voice.clone();
    voices.push(clone);
    expect(sourceOf(clone)).toMatchObject({ loop: true, loopStart: 1, loopEnd: 2 });
    expect(sourceOf(clone).start).toHaveBeenCalledWith(0, 1.5);
    expect(() => voice.clone({ loopCount: 2 })).toThrow();
  });
});
