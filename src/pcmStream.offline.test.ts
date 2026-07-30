import { describe, expect, it } from "vitest";

import { createOfflineNodeCacophony } from "./node";

function longestAudibleRun(samples: Float32Array, threshold = 1e-5): number {
  let longest = 0;
  let current = 0;
  for (const sample of samples) {
    if (Math.abs(sample) > threshold) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

describe("PcmStreamSound offline rendering", () => {
  it("plays pushed chunks gaplessly across their boundary through the public API", async () => {
    const sampleRate = 48_000;
    const chunkFrames = 128;
    const { cacophony, context } = await createOfflineNodeCacophony({
      length: 1024,
      numberOfChannels: 2,
      sampleRate,
      quiet: true,
    });
    const sound = await cacophony.createPcmStreamSound({
      bufferDuration: 0.1,
      channelCount: 1,
      latency: 0,
      panType: "stereo",
    });
    sound.write(new Float32Array(chunkFrames).fill(0.5));
    sound.write(new Float32Array(chunkFrames).fill(0.25));
    sound.play();
    sound.end();

    const rendered = await context.startRendering();
    const left = rendered.getChannelData(0);

    expect(longestAudibleRun(left)).toBeGreaterThanOrEqual(chunkFrames * 2);
  });
});
