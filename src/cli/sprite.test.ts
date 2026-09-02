import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioContext } from "standardized-audio-context-mock";
import { describe, expect, it, vi } from "vitest";
import type { SpriteMap } from "../audioSprite";
import { nodeBackendAvailable } from "../backend-available";
import { createNodeCacophony, decodeAudioFile } from "../node";
import { buildSpriteAtlas, generateSprite } from "./sprite";
import { encodeWav } from "./wav";

function makeBuffer(context: AudioContext, channels: readonly number[][], sampleRate = 1_000) {
  const buffer = context.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((data, channel) => buffer.getChannelData(channel).set(data));
  return buffer;
}

describe("sprite CLI atlas construction", () => {
  it("concatenates channels with a frame-rounded gap and canonical seconds map", () => {
    const context = new AudioContext({ sampleRate: 1_000 });
    const laser = makeBuffer(context, [
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const engine = makeBuffer(context, [
      [0.5, 0.6, 0.7],
      [0.8, 0.9, 1],
    ]);

    const result = buildSpriteAtlas(
      context,
      [
        { name: "laser", buffer: laser },
        { name: "engine", buffer: engine },
      ],
      1.6,
    );

    expect(result.gapFrames).toBe(2);
    expect(result.buffer.length).toBe(7);
    expect(result.buffer.getChannelData(0)).toEqual(Float32Array.from([0.1, 0.2, 0, 0, 0.5, 0.6, 0.7]));
    expect(result.buffer.getChannelData(1)).toEqual(Float32Array.from([0.3, 0.4, 0, 0, 0.8, 0.9, 1]));
    expect(result.map).toEqual({
      laser: { start: 0, duration: 0.002 },
      engine: { start: 0.004, duration: 0.003 },
    });
  });

  it("rejects invalid gaps, duplicate stems, mixed channels, and mixed sample rates", () => {
    const context = new AudioContext({ sampleRate: 1_000 });
    const mono = makeBuffer(context, [[1, 2]]);
    const stereo = makeBuffer(context, [
      [1, 2],
      [3, 4],
    ]);
    const otherRate = makeBuffer(context, [[1, 2]], 2_000);

    expect(() => buildSpriteAtlas(context, [{ name: "one", buffer: mono }], Number.NaN)).toThrow("Invalid --gap");
    expect(() =>
      buildSpriteAtlas(context, [
        { name: "same", buffer: mono },
        { name: "same", buffer: mono },
      ]),
    ).toThrow("duplicate input name");
    expect(() =>
      buildSpriteAtlas(context, [
        { name: "mono", buffer: mono },
        { name: "stereo", buffer: stereo },
      ]),
    ).toThrow("same channel count");
    expect(() =>
      buildSpriteAtlas(context, [
        { name: "first", buffer: mono },
        { name: "second", buffer: otherRate },
      ]),
    ).toThrow("same sample rate");
  });

  it("uses a null output sink so sprite generation does not require an audio device", async () => {
    const expected = new Error("context factory sentinel");
    const contextFactory = vi.fn(async (options: Parameters<typeof createNodeCacophony>[0]) => {
      expect(options).toEqual({ quiet: true, sinkId: { type: "none" } });
      throw expected;
    });

    await expect(generateSprite([], "atlas.wav", "atlas.json", 0, contextFactory)).rejects.toBe(expected);
    expect(contextFactory).toHaveBeenCalledOnce();
  });

  it.skipIf(!nodeBackendAvailable)("writes a WAV and map that createSprite can consume", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cacophony-sprite-"));
    try {
      const context = new AudioContext({ sampleRate: 48_000 });
      const laser = makeBuffer(context, [[0.1, 0.2, 0.3]], 48_000);
      const engine = makeBuffer(context, [[-0.1, -0.2]], 48_000);
      const laserPath = join(directory, "laser.wav");
      const enginePath = join(directory, "engine.wav");
      const atlasPath = join(directory, "atlas.wav");
      const mapPath = join(directory, "atlas.json");
      writeFileSync(laserPath, encodeWav(laser, { bitDepth: 32 }));
      writeFileSync(enginePath, encodeWav(engine, { bitDepth: 32 }));

      await generateSprite([laserPath, enginePath], atlasPath, mapPath, 1);

      const { cacophony, context: nodeContext } = await createNodeCacophony({ quiet: true });
      try {
        const atlas = await decodeAudioFile(nodeContext, atlasPath);
        const map = JSON.parse(readFileSync(mapPath, "utf8")) as SpriteMap;
        const sprite = await cacophony.createSprite(atlas, map, { panType: "stereo" });
        expect(sprite.names).toEqual(["laser", "engine"]);
        expect(sprite.sounds.laser.buffer).toBe(atlas);
        expect(sprite.sounds.engine.buffer).toBe(atlas);
        expect(map.laser.duration).toBe(3 / 48_000);
        expect(map.engine.duration).toBe(2 / 48_000);
        expect(map.engine.start).toBe((3 + 48) / 48_000);
        sprite.cleanup();
      } finally {
        await nodeContext.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
