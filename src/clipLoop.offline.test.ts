import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { createOfflineNodeCacophony } from "./node";

describe.skipIf(!nodeBackendAvailable)("native buffer clip rendering", () => {
  for (const mode of ["finite", "infinite", "cancel"] as const) {
    it(`renders ${mode} loops without any decoded suffix or stale onset`, async () => {
      const sampleRate = 48_000;
      const { cacophony, context } = await createOfflineNodeCacophony({
        length: 512,
        numberOfChannels: 1,
        sampleRate,
        quiet: true,
      });
      const buffer = context.createBuffer(1, 128, sampleRate);
      buffer.getChannelData(0).fill(0.25, 0, 64);
      buffer.getChannelData(0).fill(-0.5, 64);
      const sound = await cacophony.createSound(buffer, "buffer", "stereo");
      const [voice] = sound.preplay();
      voice.setLoopRegion(32 / sampleRate, 64 / sampleRate);
      voice.loop("infinite");
      let ended = 0;
      const terminal = new Promise<void>((resolve) =>
        voice.on("ended", () => {
          ended++;
          resolve();
        }),
      );
      voice.play({ at: 16 / sampleRate });
      if (mode !== "infinite") voice.scheduleStop((mode === "cancel" ? 8 : 288) / sampleRate);
      try {
        const audio = await context.startRendering(),
          samples = audio.getChannelData(0);
        if (mode !== "infinite") await terminal;
        expect(samples.every((sample) => sample >= -1e-6)).toBe(true);
        expect(samples.slice(0, 16).every((sample) => Math.abs(sample) < 1e-6)).toBe(true);
        expect(samples.slice(mode === "cancel" ? 0 : 288).every((sample) => Math.abs(sample) < 1e-6)).toBe(
          mode !== "infinite",
        );
        expect(samples.some((sample) => sample > 0.1)).toBe(mode !== "cancel");
        expect(ended).toBe(mode === "infinite" ? 0 : 1);
        expect(voice.state).toBe(mode === "infinite" ? "playing" : "stopped");
      } finally {
        sound.cleanup();
        cacophony.dispose();
      }
    });
  }
});
