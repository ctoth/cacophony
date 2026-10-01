import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { createOfflineNodeCacophony } from "./node";

async function render(sampleRate: number, frequency: number, amount?: number, reset = false) {
  const { cacophony, context } = await createOfflineNodeCacophony({
    length: sampleRate / 4,
    numberOfChannels: 1,
    sampleRate,
    quiet: true,
  });
  const buffer = context.createBuffer(1, sampleRate / 4, sampleRate);
  const input = buffer.getChannelData(0);
  for (let i = 0; i < input.length; i++) input[i] = 0.25 * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  const sound = await cacophony.createSound(buffer, "buffer", "stereo");
  const [voice] = sound.preplay();
  if (amount !== undefined) voice.setOcclusion(amount, 0);
  if (reset) voice.setOcclusion(0, 0);
  voice.play();
  const result = await context.startRendering();
  sound.cleanup();
  return result.getChannelData(0).slice(sampleRate / 10);
}

function rms(samples: Float32Array): number {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

describe.skipIf(!nodeBackendAvailable)("occlusion native rendering", () => {
  // Interrupted transitions render in browser-tests/occlusion.spec.ts: the Node
  // backend's async suspend registration races startRendering.
  it.each([
    32_000, 44_100, 48_000, 96_000,
  ])("restores the dry waveform across the spectrum at %i Hz", async (sampleRate) => {
    for (const frequency of [200, 4_000, sampleRate * 0.45]) {
      const dry = await render(sampleRate, frequency);
      const reset = await render(sampleRate, frequency, 1, true);
      expect(Math.max(...reset.map((value, i) => Math.abs(value - dry[i]!)))).toBeLessThan(1e-6);
    }
  });

  it("attenuates low frequencies by 18 dB and rolls off high frequencies without resonance", async () => {
    const sampleRate = 48_000;
    const lowDry = rms(await render(sampleRate, 100));
    const lowOccluded = rms(await render(sampleRate, 100, 1));
    expect(20 * Math.log10(lowOccluded / lowDry)).toBeCloseTo(-18, 1);
    const highDry = rms(await render(sampleRate, 8_000));
    const highOccluded = rms(await render(sampleRate, 8_000, 1));
    expect(highOccluded / highDry).toBeLessThan(0.002);
    const cutoffDry = rms(await render(sampleRate, 800));
    const cutoffOccluded = rms(await render(sampleRate, 800, 1));
    expect(20 * Math.log10(cutoffOccluded / cutoffDry)).toBeCloseTo(-21.0103, 1);
  });
});
