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
  if (listener) cacophony.listenerPosition = [0, 0, 4];
  else sound.position = [0, 0, -5];
  // The native backend requires suspend registration before rendering starts.
  // Use one interruption per render; the browser fixture covers multiple points.
  const suspension = context.suspend(0.1);
  const rendering = context.startRendering();
  await suspension;
  if (listener) cacophony.listenerPosition = [0, 0, 1];
  else sound.position = [0, 0, -2];
  await context.resume();
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
    // Start an envelope at time 0, then interrupt it at the one registered pause.
    voice.stereoPan = 1;
    const pause = context.suspend(0.1);
    const rendering = context.startRendering();
    await pause;
    const interruptionTime = context.currentTime;
    voice.stereoPan = -1;
    voice.spatialSmoothingTau = 0.05;
    await context.resume();
    const right = (await rendering).getChannelData(1);
    const interruptedPan = 1 - 2 * Math.exp(-interruptionTime / 0.1);
    const frame = Math.round(interruptionTime * sampleRate);
    expect(right[frame]! / 0.25).toBeCloseTo(Math.sin(((interruptedPan! + 1) * Math.PI) / 4), 3);
    expect(Math.abs(right[frame]! - right[frame - 1]!)).toBeLessThan(0.0001);
    const laterFrame = Math.round((interruptionTime + 0.05) * sampleRate);
    const laterPan = -1 + (interruptedPan + 1) * Math.exp(-1);
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
