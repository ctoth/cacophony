import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { createOfflineNodeCacophony } from "./node";

describe.skipIf(!nodeBackendAvailable)("native source send envelopes", () => {
  it("makes an exponential fade exactly silent at the endpoint", async () => {
    const sampleRate = 48_000;
    const { cacophony, context } = await createOfflineNodeCacophony({
      length: sampleRate / 4,
      numberOfChannels: 1,
      sampleRate,
      quiet: true,
    });
    const buffer = context.createBuffer(1, sampleRate / 4, sampleRate);
    buffer.getChannelData(0).fill(0.25);
    const sound = await cacophony.createSound(buffer, "buffer", "stereo");
    const dry = cacophony.createBus();
    dry.disconnect(cacophony.master);
    const aux = cacophony.createBus();
    sound.routeTo(dry);
    sound.routeTo(aux, 1);
    const [voice] = sound.preplay();
    sound.routeTo(aux, 0, { duration: 100, type: "exponential" });
    voice.play();
    const samples = (await context.startRendering()).getChannelData(0);
    expect(samples[2400]! / samples[0]!).toBeCloseTo(0.01, 5);
    expect(samples.slice(4800).every((value) => value === 0)).toBe(true);
    sound.cleanup();
  });

  it.each(["linear", "exponential"] as const)("interrupts a %s send ramp without a gain jump", async (type) => {
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
    // A disconnected primary bus isolates the aux envelope at the destination.
    const dry = cacophony.createBus();
    dry.disconnect(cacophony.master);
    const aux = cacophony.createBus();
    sound.routeTo(dry);
    sound.routeTo(aux, 1);
    const [voice] = sound.preplay();
    sound.routeTo(aux, 0.25, { duration: 200, type });
    voice.play();
    const suspended = context.suspend(0.1);
    const rendering = context.startRendering();
    await suspended;
    const frame = Math.round(context.currentTime * sampleRate);
    const fraction = context.currentTime / 0.2;
    const expected = type === "linear" ? 1 - 0.75 * fraction : 0.25 ** fraction;
    sound.routeTo(aux, 1, { duration: 100 });
    await context.resume();
    const samples = (await rendering).getChannelData(0);
    const fullLevel = samples[sampleRate * 0.4]!;
    expect(fullLevel).toBeGreaterThan(0.1);
    expect(Math.abs(samples[frame]! - samples[frame - 1]!)).toBeLessThan(0.001);
    expect(samples[frame]! / fullLevel).toBeCloseTo(expected, 3);
    expect(samples[frame + 2400]! / fullLevel).toBeCloseTo((expected + 1) / 2, 3);
    expect(samples[sampleRate * 0.3]! / fullLevel).toBeCloseTo(1, 5);
    sound.cleanup();
  });
});
