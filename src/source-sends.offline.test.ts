import { describe, expect, it } from "vitest";
import { nodeBackendAvailable } from "./backend-available";
import { createOfflineNodeCacophony } from "./node";

describe.skipIf(!nodeBackendAvailable)("native source send envelopes", () => {
  // Interrupted ramps render in browser-tests/source-sends.spec.ts: the Node
  // backend's async suspend registration races startRendering.
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
});
