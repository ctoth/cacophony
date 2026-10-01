import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { createOfflineNodeCacophony } from "./node";

async function renderInitialPose(tau: number, panType: "stereo" | "HRTF", synth: boolean) {
  const sampleRate = 48_000;
  const { cacophony, context } = await createOfflineNodeCacophony({
    length: sampleRate / 4,
    sampleRate,
    spatialSmoothingTau: tau,
    quiet: true,
  });
  const buffer = context.createBuffer(1, sampleRate / 4, sampleRate);
  buffer.getChannelData(0).fill(0.25);
  const sound = synth
    ? cacophony.createOscillator({ type: "sine", frequency: 220 }, panType)
    : await cacophony.createSound(buffer, "buffer", panType);
  if (panType === "stereo") sound.stereoPan = -0.8;
  else sound.position = [1, 0, -3];
  sound.play(panType === "stereo" ? { stereoPan: 0.5 } : { position: [2, 0, -4] });
  const rendered = await context.startRendering();
  sound.stop();
  sound.cleanup();
  return [rendered.getChannelData(0), rendered.getChannelData(1)];
}

describe.skipIf(!nodeBackendAvailable)("spatial smoothing native initialization", () => {
  // Node's async suspend registration can race startRendering, and that backend
  // cannot register another suspend once rendering has begun. Interrupted-motion
  // rendering lives in browser-tests/spatial-smoothing.spec.ts instead.
  it.each(["stereo", "HRTF"] as const)("starts buffer and synth voices at their requested %s pose", async (panType) => {
    for (const synth of [false, true]) {
      const instant = await renderInitialPose(0, panType, synth);
      const smooth = await renderInitialPose(0.1, panType, synth);
      for (let channel = 0; channel < 2; channel++) {
        const reference = instant[channel]!;
        const samples = smooth[channel]!;
        expect(Math.max(...samples.map((value) => Math.abs(value)))).toBeGreaterThan(0.001);
        expect(Math.max(...samples.map((value, i) => Math.abs(value - reference[i]!)))).toBeLessThan(1e-6);
      }
    }
  });
});
