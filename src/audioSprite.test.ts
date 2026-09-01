import { AudioBuffer } from "standardized-audio-context-mock";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { AudioSprite } from "./audioSprite";
import { audioContextMock, cacophony, mockCache } from "./setupTests";

function instrumentBufferSourceStarts(): void {
  const createBufferSource = audioContextMock.createBufferSource.bind(audioContextMock);
  vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
    const source = createBufferSource();
    vi.spyOn(source, "start");
    return source;
  });
}

describe("audio sprites", () => {
  it("creates typed ordinary Sounds sharing one AudioBuffer", async () => {
    const buffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const sprite = await cacophony.createSprite(buffer, {
      laser: { start: 1, duration: 2 },
      engine: { start: 4, duration: 3, loopCount: "infinite" },
    } as const);

    expectTypeOf(sprite).toMatchTypeOf<AudioSprite<"laser" | "engine">>();
    expect(sprite.names).toEqual(["laser", "engine"]);
    expect(Object.isFrozen(sprite.names)).toBe(true);
    expect(Object.isFrozen(sprite.sounds)).toBe(true);
    expect(sprite.sounds.laser.buffer).toBe(buffer);
    expect(sprite.sounds.engine.buffer).toBe(buffer);
    expect(sprite.sounds.laser.duration).toBe(2);
    expect(sprite.sounds.engine.loop()).toBe("infinite");
    expect(sprite.has("laser")).toBe(true);
    expect(sprite.has("missing")).toBe(false);
    expect(() => sprite.get("missing" as "laser")).toThrow("Unknown audio sprite name: missing");

    sprite.cleanup();
    sprite.cleanup();
  });

  it("fetches and decodes a URL atlas once", async () => {
    const before = mockCache.getAudioBuffer.mock.calls.length;
    const sprite = await cacophony.createSprite("atlas.wav", { tick: { start: 0, duration: 0.001 } });

    expect(mockCache.getAudioBuffer.mock.calls.length - before).toBe(1);
    expect(sprite.sounds.tick.url).toBe("atlas.wav");
    sprite.cleanup();
  });

  it("translates scheduled region playback to absolute buffer offsets", async () => {
    instrumentBufferSourceStarts();
    const buffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const sprite = await cacophony.createSprite(buffer, { clip: { start: 2, duration: 4 } });
    const [prepared] = sprite.sounds.clip.preplay();
    prepared.seek(1.5);
    const preplay = vi.spyOn(sprite.sounds.clip, "preplay").mockReturnValue([prepared]);

    const [playback] = sprite.sounds.clip.play({ at: 8 });

    expect(playback.source && "start" in playback.source ? playback.source.start : undefined).toHaveBeenCalledWith(
      8,
      3.5,
      2.5,
    );
    expect(playback.duration).toBe(4);
    expect(playback.currentTime).toBe(1.5);
    preplay.mockRestore();
    sprite.cleanup();
  });

  it("sets region bounds for infinite loops and omits the start duration", async () => {
    instrumentBufferSourceStarts();
    const buffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const sprite = await cacophony.createSprite(buffer, {
      engine: { start: 2, duration: 4, loopCount: "infinite" },
    });

    const [playback] = sprite.sounds.engine.play({ at: 5 });
    const source = playback.source!;

    expect("loop" in source && source.loop).toBe(true);
    expect("loopStart" in source ? source.loopStart : undefined).toBe(2);
    expect("loopEnd" in source ? source.loopEnd : undefined).toBe(6);
    expect("start" in source ? source.start : undefined).toHaveBeenCalledWith(5, 2);
    sprite.cleanup();
  });

  it("wraps a paused infinite loop to a region-relative offset", async () => {
    instrumentBufferSourceStarts();
    let currentTime = 0;
    vi.spyOn(audioContextMock, "currentTime", "get").mockImplementation(() => currentTime);
    const buffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const sprite = await cacophony.createSprite(buffer, {
      engine: { start: 2, duration: 4, loopCount: "infinite" },
    });
    const [playback] = sprite.sounds.engine.play();

    currentTime = 9;
    playback.pause();
    expect(playback.currentTime).toBe(1);

    playback.play();
    expect(playback.source && "start" in playback.source ? playback.source.start : undefined).toHaveBeenCalledWith(
      0,
      3,
    );
    sprite.cleanup();
  });

  it("recreates active region sources when switching between finite and infinite loops", async () => {
    instrumentBufferSourceStarts();
    const buffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const sprite = await cacophony.createSprite(buffer, { clip: { start: 2, duration: 4 } });
    const [playback] = sprite.sounds.clip.play();

    playback.loop("infinite");
    const infiniteSource = playback.source!;
    expect("loop" in infiniteSource && infiniteSource.loop).toBe(true);
    expect("start" in infiniteSource ? infiniteSource.start : undefined).toHaveBeenCalledWith(0, 2);

    playback.loop(0);
    const finiteSource = playback.source!;
    expect("loop" in finiteSource && finiteSource.loop).toBe(false);
    expect("start" in finiteSource ? finiteSource.start : undefined).toHaveBeenCalledWith(0, 2, 4);
    sprite.cleanup();
  });

  it("restarts finite loops at the region start", async () => {
    instrumentBufferSourceStarts();
    const buffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const sprite = await cacophony.createSprite(buffer, { clip: { start: 2, duration: 4, loopCount: 1 } });
    const [playback] = sprite.sounds.clip.play();

    playback.loopEnded();

    expect(playback.currentLoop).toBe(1);
    expect(playback.source && "start" in playback.source ? playback.source.start : undefined).toHaveBeenCalledWith(
      0,
      2,
      4,
    );
    playback.loopEnded();
    expect(playback.isPlaying).toBe(false);
    sprite.cleanup();
  });

  it("keeps seek and clone ownership region-relative", async () => {
    instrumentBufferSourceStarts();
    const buffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const sprite = await cacophony.createSprite(buffer, { clip: { start: 2, duration: 4 } });
    const clone = sprite.sounds.clip.clone();
    const playback = clone.preplay()[0];

    expect(() => playback.seek(4.01)).toThrow("Invalid time value for seek");
    playback.seek(4);
    playback.play();
    expect(playback.currentTime).toBe(4);
    expect(playback.source && "start" in playback.source ? playback.source.start : undefined).not.toHaveBeenCalled();

    sprite.cleanup();
    expect(clone.region).toEqual({ start: 2, duration: 4 });
    expect(clone.spriteName).toBe("clip");
    expect(() => clone.play()).not.toThrow();
    clone.cleanup();
  });

  it("copies and freezes validated regions and rejects invalid maps atomically", async () => {
    const buffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const region = { start: 1, duration: 2 };
    const sprite = await cacophony.createSprite(buffer, { clip: region });
    region.start = 7;

    expect(sprite.sounds.clip.region).toEqual({ start: 1, duration: 2 });
    expect(Object.isFrozen(sprite.sounds.clip.region)).toBe(true);
    await expect(cacophony.createSprite(buffer, {})).rejects.toThrow("at least one region");
    await expect(cacophony.createSprite(buffer, { bad: { start: -1, duration: 1 } })).rejects.toThrow("start");
    await expect(cacophony.createSprite(buffer, { bad: { start: 9, duration: 2 } })).rejects.toThrow("exceeds");
    await expect(cacophony.createSprite(buffer, { bad: { start: 1, duration: 1, loopCount: 1.5 } })).rejects.toThrow(
      "loopCount",
    );
    sprite.cleanup();
  });

  it("accepts frame-exact regions despite floating-point division without relaxing bounds", async () => {
    const sampleRate = 44_100;
    const buffer = new AudioBuffer({ length: 15, numberOfChannels: 1, sampleRate });

    const sprite = await cacophony.createSprite(buffer, {
      last: { start: 2 / sampleRate, duration: 13 / sampleRate },
    });

    expect(sprite.sounds.last.duration).toBe(13 / sampleRate);
    await expect(
      cacophony.createSprite(buffer, { bad: { start: 2 / sampleRate, duration: 14 / sampleRate } }),
    ).rejects.toThrow("exceeds");
    sprite.cleanup();
  });

  it("allows a child to be cleaned before its owning sprite", async () => {
    const buffer = new AudioBuffer({ length: 100, numberOfChannels: 1, sampleRate: 10 });
    const sprite = await cacophony.createSprite(buffer, {
      first: { start: 0, duration: 2 },
      second: { start: 2, duration: 2 },
    });

    sprite.sounds.first.cleanup();

    expect(() => sprite.cleanup()).not.toThrow();
  });

  it("time-stretches only the selected region into a standalone Sound", async () => {
    const buffer = audioContextMock.createBuffer(1, 10, 10);
    buffer.getChannelData(0).set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const sprite = await cacophony.createSprite(buffer, { clip: { start: 0.2, duration: 0.3 } });
    const stretch = vi.spyOn(cacophony, "timeStretchBuffer").mockImplementation((input) => input);

    const stretched = sprite.sounds.clip.timeStretch(1);

    expect(stretch).toHaveBeenCalledOnce();
    const selected = stretch.mock.calls[0][0];
    expect(selected.length).toBe(3);
    expect([...selected.getChannelData(0)]).toEqual([2, 3, 4]);
    expect(stretched.region).toBeUndefined();
    stretched.cleanup();
    sprite.cleanup();
  });
});
