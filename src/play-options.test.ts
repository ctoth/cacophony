import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import type { PlayOptions } from "./cacophony";
import { Group } from "./group";
import { createOfflineNodeCacophony } from "./node";
import { audioContextMock, cacophony, expectPath } from "./setupTests";
import { Synth } from "./synth";

async function makeSound() {
  return cacophony.createSound(new AudioBuffer({ length: 44100, sampleRate: 44100 }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("per-playback options", () => {
  it.skipIf(!nodeBackendAvailable)(
    "renders scheduled fades toward the overridden gain at the overridden rate",
    async () => {
      const { cacophony: engine, context } = await createOfflineNodeCacophony({
        length: 4800,
        sampleRate: 48000,
        numberOfChannels: 1,
        quiet: true,
      });
      const buffer = context.createBuffer(1, 4800, 48000);
      buffer.getChannelData(0).fill(1);
      const sound = await engine.createSound(buffer, "buffer", "stereo");
      const [voice] = sound.play({ at: 0.02, volume: 0.4, playbackRate: 2, loopCount: 0, fadeIn: 20 });
      expect(voice.playbackRate).toBe(2);
      const samples = (await context.startRendering()).getChannelData(0);
      expect(Math.abs(samples[480])).toBeLessThan(1e-6);
      expect(samples[1440]).toBeGreaterThan(0);
      expect(samples[2400]).toBeGreaterThan(samples[1440] * 1.8);
      expect(samples[2400]).toBeLessThanOrEqual(0.401);
      expect(Math.abs(samples[4000])).toBeLessThan(1e-6);
    },
  );

  it.skipIf(!nodeBackendAvailable)(
    "preserves sprite regions and buffer sharing with invocation overrides",
    async () => {
      const { cacophony: engine, context } = await createOfflineNodeCacophony({
        length: 512,
        sampleRate: 48000,
        numberOfChannels: 1,
        quiet: true,
      });
      const buffer = context.createBuffer(1, 256, 48000);
      buffer.getChannelData(0).fill(0.5, 0, 128);
      buffer.getChannelData(0).fill(-0.5, 128);
      const sprite = await engine.createSprite(
        buffer,
        { a: { start: 0, duration: 128 / 48000 }, b: { start: 128 / 48000, duration: 128 / 48000 } },
        { panType: "stereo" },
      );
      const [first] = sprite.sounds.a.play({ at: 0, volume: 0.5, playbackRate: 2, loopCount: 0, stereoPan: 0 });
      const [second] = sprite.sounds.b.play({ at: 256 / 48000, volume: 0.25 });
      expect(sprite.sounds.a.buffer).toBe(sprite.sounds.b.buffer);
      expect(first.loopCount).toBe(0);
      expect(second.playbackRate).toBe(1);
      const samples = (await context.startRendering()).getChannelData(0);
      expect(samples[32]).toBeGreaterThan(0);
      expect(Math.abs(samples[100])).toBeLessThan(1e-6);
      expect(samples[300]).toBeLessThan(0);
      expect(Math.abs(samples[400])).toBeLessThan(1e-6);
    },
  );

  it("disconnects nodes when preparation fails after the voice is constructed", async () => {
    const sound = await makeSound();
    const gain = audioContextMock.createGain();
    const panner = audioContextMock.createPanner();
    vi.spyOn(gain, "disconnect");
    vi.spyOn(panner, "disconnect");
    vi.spyOn(audioContextMock, "createGain").mockReturnValue(gain);
    vi.spyOn(audioContextMock, "createPanner").mockReturnValue(panner);
    vi.spyOn(sound, "volume", "get").mockImplementation(() => {
      throw new Error("prepare failed");
    });
    expect(() => sound.play({ volume: 0.5 })).toThrow("prepare failed");
    expect(sound.playbacks).toHaveLength(0);
    expect(gain.disconnect).toHaveBeenCalled();
    expect(panner.disconnect).toHaveBeenCalled();
  });

  it("validates direct voices before mutation and preserves play event counts", async () => {
    const sound = await makeSound();
    const [voice] = sound.preplay();
    const onPlay = vi.fn();
    sound.on("play", onPlay);
    expect(() => voice.play({ volume: 0.1, stereoPan: 0 })).toThrow();
    expect(voice.volume).toBe(sound.volume);
    expect(voice.state).toBe("unplayed");
    sound.play({ volume: 0.5 });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("configures independent voices before source start and preserves defaults", async () => {
    const sound = await makeSound();
    sound.volume = 0.8;
    sound.loop(3);
    const createSource = audioContextMock.createBufferSource.bind(audioContextMock);
    const starts: unknown[] = [];
    vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
      const source = createSource();
      vi.spyOn(source, "start").mockImplementation(() => {
        const voice = sound.playbacks[sound.playbacks.length - 1];
        starts.push([voice.volume, voice.playbackRate, voice.loopCount, voice.panType, voice.stereoPan]);
      });
      return source;
    });
    const [first] = sound.play({ volume: 0, playbackRate: 2, loopCount: 0, panType: "stereo", stereoPan: 0 });
    const [second] = sound.play({
      volume: 0.5,
      playbackRate: 0.5,
      loopCount: "infinite",
      panType: "stereo",
      stereoPan: -1,
    });
    expect(starts).toEqual([
      [0, 2, 0, "stereo", 0],
      [0.5, 0.5, "infinite", "stereo", -1],
    ]);
    expect(first.volume).toBe(0);
    expect(second.volume).toBe(0.5);
    expect(sound.volume).toBe(0.8);
    expect(sound.loopCount).toBe(3);
    expect(sound.panType).toBe("HRTF");
    first.stop();
    expect(second.isPlaying).toBe(true);
    const [inherited] = sound.play();
    expect(inherited.volume).toBe(0.8);
    expect(inherited.loopCount).toBe(3);
  });

  it.skipIf(!nodeBackendAvailable)("merges partial HRTF settings and switches either pan mode", async () => {
    const { cacophony: engine, context } = await createOfflineNodeCacophony({
      length: 4800,
      sampleRate: 48000,
      quiet: true,
    });
    const sound = await engine.createSound(context.createBuffer(1, 4800, 48000));
    sound.threeDOptions = { refDistance: 7, rolloffFactor: 0.8 };
    const [voice] = sound.play({ position: [10, 0, 5], threeDOptions: { rolloffFactor: 0.1 } });
    expect(voice.position).toEqual([10, 0, 5]);
    expect(voice.threeDOptions).toMatchObject({ refDistance: 7, rolloffFactor: 0.1 });
    expect(sound.threeDOptions).toMatchObject({ refDistance: 7, rolloffFactor: 0.8 });
    const [stereo] = sound.play({ panType: "stereo", stereoPan: 0.2 });
    expect(stereo.panType).toBe("stereo");
    stereo.stop();
    stereo.play({ panType: "HRTF", position: [1, 2, 3] });
    expect(stereo.position).toEqual([1, 2, 3]);
    expect(stereo.panType).toBe("HRTF");
    sound.stop();
  });

  it.each<PlayOptions>([
    { volume: Number.NaN },
    { playbackRate: 0 },
    { playbackRate: Infinity },
    { loopCount: -1 },
    { loopCount: 1.5 },
    { stereoPan: 0 },
    { panType: "stereo", position: [0, 0, 0] },
    { panType: "stereo", threeDOptions: { rolloffFactor: 1 } },
    { position: [0, Infinity, 0] },
    { threeDOptions: { coneOuterGain: 2 } },
    { at: Number.NaN },
    { fadeIn: -1 },
  ])("rejects invalid options before allocating a voice: %j", async (options) => {
    const sound = await makeSound();
    const [existing] = sound.play();
    const preplay = vi.spyOn(sound, "preplay");
    expect(() => sound.play(options)).toThrow();
    expect(preplay).not.toHaveBeenCalled();
    expect(sound.playbacks).toEqual([existing]);
    expect(existing.isPlaying).toBe(true);
  });

  it("preflights all group members and preserves the ordered cursor on rejection", async () => {
    const hrtf = await makeSound();
    const stereo = await makeSound();
    stereo.panType = "stereo";
    const group = new Group([hrtf, stereo]);
    expect(() => group.play({ position: [1, 2, 3] })).toThrow();
    expect(hrtf.playbacks).toHaveLength(0);
    expect(stereo.playbacks).toHaveLength(0);
    expect(() => group.playOrdered(false, { stereoPan: 0 })).toThrow();
    expect(group.playOrdered(false, { volume: 0 })?.origin).toBe(hrtf);
    expect(group.playOrdered(false, { volume: 0 })?.origin).toBe(stereo);
    expect(group.playOrdered(false)).toBeUndefined();
    group.resetOrder();
    expect(group.playOrdered()?.origin).toBe(hrtf);
    expect(group.play({ panType: "stereo", stereoPan: 0, volume: 0.3 }).map((p) => p.volume)).toEqual([0.3, 0.3]);
    expect(group.playRandom({ volume: 0.6 })?.volume).toBe(0.6);
    expect(new Group().play()).toEqual([]);
    expect(new Group().playRandom()).toBeUndefined();
    expect(new Group().playOrdered()).toBeUndefined();
  });

  it("applies options and fades on direct Playback.play with scheduled starts", async () => {
    const sound = await makeSound();
    const [voice] = sound.preplay();
    const source = audioContextMock.createBufferSource();
    const start = vi.spyOn(source, "start");
    vi.spyOn(audioContextMock, "createBufferSource").mockReturnValue(source);
    const fade = vi.spyOn(voice, "fadeIn");
    const fadeOut = vi.spyOn(voice, "configureFadeOut");
    const at = audioContextMock.currentTime + 5;
    voice.play({ at, volume: 0.4, playbackRate: 2, loopCount: 0, fadeIn: 100, fadeOut: 50 });
    expect(start).toHaveBeenCalledWith(at, 0);
    expect(voice.playbackRate).toBe(2);
    expect(fade).toHaveBeenCalledWith(100, undefined, { perLoop: undefined, startTime: at });
    expect(fadeOut).toHaveBeenCalledWith(50, undefined);
  });

  it("supports synth gain and spatial options and rejects buffer-only controls before preparation", () => {
    const synth = new Synth(audioContextMock, audioContextMock.createGain());
    const preplay = vi.spyOn(synth, "preplay");
    expect(() => synth.play({ playbackRate: 2 })).toThrow();
    expect(() => synth.play({ loopCount: 0 })).toThrow();
    expect(preplay).not.toHaveBeenCalled();
    const [voice] = synth.play({ volume: 0, panType: "stereo", stereoPan: 0 });
    expect(voice.volume).toBe(0);
    expect(voice.stereoPan).toBe(0);
    expectPath(voice.source!, [voice.panner!], voice.gainNode!);
    synth.stop();
  });

  it("cleans newly prepared voices when source start throws", async () => {
    const sound = await makeSound();
    const [existing] = sound.play();
    const prepare = sound.preplay.bind(sound);
    let failed: ReturnType<typeof prepare>[number] | undefined;
    vi.spyOn(sound, "preplay").mockImplementation(() => {
      const voices = prepare();
      failed = voices[0];
      return voices;
    });
    const createSource = audioContextMock.createBufferSource.bind(audioContextMock);
    vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
      const source = createSource();
      vi.spyOn(source, "start").mockImplementation(() => {
        throw new Error("start failed");
      });
      return source;
    });
    expect(() => sound.play({ volume: 0.5 })).toThrow("start failed");
    expect(sound.playbacks).toEqual([existing]);
    expect(failed?.source).toBeUndefined();
    expect(failed?.gainNode).toBeUndefined();
    expect(existing.isPlaying).toBe(true);
  });
});
