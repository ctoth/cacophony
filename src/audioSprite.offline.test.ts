import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { createOfflineNodeCacophony } from "./node";

describe.skipIf(!nodeBackendAvailable)("audio sprite offline rendering", () => {
  it("renders scheduled child regions without neighboring atlas bleed", async () => {
    const sampleRate = 48_000;
    const regionFrames = 64;
    const firstStart = 32;
    const secondStart = 160;
    const { cacophony, context } = await createOfflineNodeCacophony({
      length: 320,
      numberOfChannels: 1,
      sampleRate,
      quiet: true,
    });
    const atlas = context.createBuffer(1, regionFrames * 2, sampleRate);
    atlas.getChannelData(0).fill(0.25, 0, regionFrames);
    atlas.getChannelData(0).fill(-0.5, regionFrames);
    const sprite = await cacophony.createSprite(
      atlas,
      {
        positive: { start: 0, duration: regionFrames / sampleRate },
        negative: { start: regionFrames / sampleRate, duration: regionFrames / sampleRate },
      },
      { panType: "stereo" },
    );

    sprite.sounds.positive.play({ at: firstStart / sampleRate });
    sprite.sounds.negative.play({ at: secondStart / sampleRate });

    const rendered = await context.startRendering();
    const samples = rendered.getChannelData(0);
    expect(samples.slice(firstStart + 1, firstStart + regionFrames - 1).every((sample) => sample > 0)).toBe(true);
    expect(
      samples.slice(firstStart + regionFrames + 1, secondStart - 1).every((sample) => Math.abs(sample) < 1e-6),
    ).toBe(true);
    expect(samples.slice(secondStart + 1, secondStart + regionFrames - 1).every((sample) => sample < 0)).toBe(true);
    expect(Math.abs(samples[secondStart + regionFrames + 1])).toBeLessThan(1e-6);
  });
});
