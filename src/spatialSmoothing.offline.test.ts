import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { createOfflineNodeCacophony } from "./node";

const sampleRate = 48_000;

function maximumStep(samples: Float32Array, from: number, to = samples.length): number {
  let maximum = 0;
  for (let i = from; i < to; i++) maximum = Math.max(maximum, Math.abs(samples[i]! - samples[i - 1]!));
  return maximum;
}

async function renderMotion(tau: number, listener: boolean) {
  const { cacophony, context } = await createOfflineNodeCacophony({
    length: sampleRate / 2,
    sampleRate,
    spatialSmoothingTau: tau,
    quiet: true,
  });
  const buffer = context.createBuffer(1, sampleRate / 2, sampleRate);
  buffer.getChannelData(0).fill(0.25);
  const sound = await cacophony.createSound(buffer, "buffer", "HRTF");
  sound.position = [0, 0, -1];
  sound.play();
  const times = [0.1, 0.15, 0.2, 0.25];
  const distances = [5, 2, 8, 1];
  const suspensions = times.map((time) => context.suspend(time));
  const rendering = context.startRendering();
  for (let i = 0; i < suspensions.length; i++) {
    await suspensions[i];
    if (listener) cacophony.listenerPosition = [0, 0, distances[i]! - 1];
    else sound.position = [0, 0, -distances[i]!];
    await context.resume();
  }
  const samples = (await rendering).getChannelData(0);
  sound.cleanup();
  return samples;
}

describe.skipIf(!nodeBackendAvailable)("spatial smoothing native rendering", () => {
  it("preserves the interrupted stereo envelope and changes tau without a jump", async () => {
    const { cacophony, context } = await createOfflineNodeCacophony({
      length: sampleRate / 2,
      sampleRate,
      spatialSmoothingTau: 0.1,
      quiet: true,
    });
    const buffer = context.createBuffer(1, sampleRate / 2, sampleRate);
    buffer.getChannelData(0).fill(0.25);
    const sound = await cacophony.createSound(buffer, "buffer", "stereo");
    sound.stereoPan = -1;
    const [voice] = sound.play();
    const pauses = [0.1, 0.15, 0.2].map((time) => context.suspend(time));
    const rendering = context.startRendering();
    await pauses[0];
    const firstTime = context.currentTime;
    voice.stereoPan = 1;
    await context.resume();
    await pauses[1];
    const secondTime = context.currentTime;
    voice.stereoPan = -1;
    await context.resume();
    await pauses[2];
    const thirdTime = context.currentTime;
    voice.spatialSmoothingTau = 0.05;
    await context.resume();
    const right = (await rendering).getChannelData(1);
    const atSecond = 1 - 2 * Math.exp(-(secondTime - firstTime) / 0.1);
    const atThird = -1 + (atSecond + 1) * Math.exp(-(thirdTime - secondTime) / 0.1);
    for (const [time, pan] of [
      [secondTime, atSecond],
      [thirdTime, atThird],
    ]) {
      const frame = Math.round(time! * sampleRate);
      expect(right[frame]! / 0.25).toBeCloseTo(Math.sin(((pan! + 1) * Math.PI) / 4), 3);
      expect(Math.abs(right[frame]! - right[frame - 1]!)).toBeLessThan(0.0001);
    }
    const laterFrame = Math.round((thirdTime + 0.05) * sampleRate);
    const laterPan = -1 + (atThird + 1) * Math.exp(-1);
    expect(right[laterFrame]! / 0.25).toBeCloseTo(Math.sin(((laterPan + 1) * Math.PI) / 4), 3);
    sound.cleanup();
  });

  it.each([false, true])("reduces HRTF distance-motion discontinuities (listener=%s)", async (listener) => {
    const instant = await renderMotion(0, listener);
    const smooth = await renderMotion(0.05, listener);
    const from = Math.round(sampleRate * 0.09);
    const instantStep = maximumStep(instant, from);
    const smoothStep = maximumStep(smooth, from);
    expect(instantStep).toBeGreaterThan(0.001);
    expect(smoothStep).toBeLessThan(instantStep / 5);
    expect(smooth.every(Number.isFinite)).toBe(true);
  });
});
