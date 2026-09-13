import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bus } from "./bus";
import { cacophony, expectNotReachable, expectPath } from "./setupTests";
import type { Sound } from "./sound";

describe("Sound readmission after reaping (#212)", () => {
  let sound: Sound;

  beforeEach(async () => {
    sound = await cacophony.createSound(new AudioBuffer({ length: 100, sampleRate: 44100 }));
  });

  afterEach(() => {
    sound.cleanup();
    vi.restoreAllMocks();
  });

  it("restores the current primary route and sends on replay", () => {
    const oldBus = new Bus(cacophony.context, null);
    const nextBus = new Bus(cacophony.context, null);
    sound.routeTo(oldBus);
    sound.routeTo(oldBus, 0.2);
    const [voice] = sound.play();
    voice.stop();
    sound.preplay();
    oldBus.destroy({ drainTo: nextBus });
    sound.routeTo(nextBus, 0.7);

    voice.play();

    expectPath(voice.outputNode, [], nextBus.input);
    expectNotReachable(voice.outputNode, oldBus.input);
    expect(voice._sendGains.size).toBe(1);
    const send = voice._sendGains.get(nextBus)!;
    expect(send.gain.value).toBe(0.7);
    expectPath(voice.outputNode, [send], nextBus.input);
  });

  it("disconnects reaped output and sends without destroying replay state", () => {
    const bus = new Bus(cacophony.context, null);
    sound.routeTo(bus, 0.5);
    const [voice] = sound.play();
    const output = voice.outputNode;
    const send = voice._sendGains.get(bus)!;
    voice.stop();
    sound.preplay();
    sound.cleanup();

    expectNotReachable(output, cacophony.master.input);
    expectNotReachable(output, bus.input);
    expectNotReachable(send, bus.input);
    expect(voice.source).toBeDefined();
    voice.cleanup();
  });

  it("restores ended, loop, and error forwarding after natural end", async () => {
    const ended = vi.fn();
    const loopEnd = vi.fn();
    const soundError = vi.fn();
    sound.on("ended", ended);
    sound.on("loopEnd", loopEnd);
    sound.on("soundError", soundError);
    const [voice] = sound.play();
    voice.loopEnded();
    expect(ended).toHaveBeenCalledTimes(1);

    voice.loop(1);
    voice.play();
    voice.loopEnded();
    expect(loopEnd).toHaveBeenCalledTimes(1);
    await voice.emitAsync("error", {
      error: new Error("test"),
      errorType: "source",
      timestamp: 0,
      recoverable: true,
    });
    expect(soundError).toHaveBeenCalledTimes(1);
    voice.loopEnded();
    expect(ended).toHaveBeenCalledTimes(2);
    voice.cleanup();
  });
});
