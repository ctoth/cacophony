import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { createOfflineNodeCacophony } from "./node";

function firstAudibleFrame(samples: Float32Array, threshold = 1e-5): number {
  return samples.findIndex((sample) => Math.abs(sample) > threshold);
}

describe.skipIf(!nodeBackendAvailable)("scheduled buffer playback offline rendering", () => {
  it("starts at the requested sample and renders adjacent clips without a gap", async () => {
    const sampleRate = 48_000;
    const startFrame = 240;
    const clipFrames = 128;
    const { cacophony, context } = await createOfflineNodeCacophony({
      length: 1_024,
      numberOfChannels: 1,
      sampleRate,
      quiet: true,
    });
    const buffer = context.createBuffer(1, clipFrames, sampleRate);
    buffer.getChannelData(0).fill(0.5);
    const sound = await cacophony.createSound(buffer, "buffer", "stereo");

    sound.play({ at: startFrame / sampleRate });
    sound.play({ at: (startFrame + clipFrames) / sampleRate });

    const rendered = await context.startRendering();
    const samples = rendered.getChannelData(0);
    expect(firstAudibleFrame(samples)).toBeGreaterThanOrEqual(startFrame - 1);
    expect(firstAudibleFrame(samples)).toBeLessThanOrEqual(startFrame + 1);
    expect(
      samples.slice(startFrame + 1, startFrame + clipFrames * 2 - 1).every((sample) => Math.abs(sample) > 1e-5),
    ).toBe(true);
  });
});
