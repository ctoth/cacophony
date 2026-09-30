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
  it("interrupts an in-flight transition without a gain jump and smoothly restores the running dry signal", async () => {
    const sampleRate = 48_000;
    const { cacophony, context } = await createOfflineNodeCacophony({
      length: sampleRate / 2,
      numberOfChannels: 1,
      sampleRate,
      quiet: true,
    });
    const buffer = context.createBuffer(1, sampleRate / 2, sampleRate);
    buffer.getChannelData(0).fill(0.25);
    const sound = await cacophony.createSound(buffer, "buffer", "stereo");
    const [voice] = sound.preplay();
    voice.setOcclusion(1, 200);
    voice.play();
    const suspended = context.suspend(0.1);
    const rendering = context.startRendering();
    await suspended;
    const interruptionFrame = Math.round(context.currentTime * sampleRate);
    voice.setOcclusion(0, 100);
    await context.resume();
    const samples = (await rendering).getChannelData(0);
    // A DC signal isolates the gain envelope once the low-pass's startup transient settles.
    expect(Math.abs(samples[interruptionFrame]! - samples[interruptionFrame - 1]!)).toBeLessThan(0.001);
    const dryLevel = samples[sampleRate * 0.4]!;
    const expectedGain = 1 + (10 ** (-18 / 20) - 1) * (interruptionFrame / sampleRate / 0.2);
    expect(samples[interruptionFrame]! / dryLevel).toBeCloseTo(expectedGain, 2);
    expect(samples[interruptionFrame + 2_400]! / dryLevel).toBeCloseTo((expectedGain + 1) / 2, 2);
    expect(Math.max(...samples.slice(sampleRate * 0.3).map((value) => Math.abs(value - dryLevel)))).toBeLessThan(1e-6);
    sound.cleanup();
  });

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
