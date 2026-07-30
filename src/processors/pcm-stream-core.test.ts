import { describe, expect, it } from "vitest";

import { PcmStreamEngine } from "./pcm-stream-core";

describe("PcmStreamEngine", () => {
  it("renders interleaved chunks gaplessly across chunk boundaries", () => {
    const engine = new PcmStreamEngine({
      capacityFrames: 8,
      channelCount: 1,
      latencyFrames: 0,
    });
    expect(engine.writeInterleaved(new Float32Array([0.1, 0.2, 0.3]))).toBe(true);
    expect(engine.writeInterleaved(new Float32Array([0.4, 0.5, 0.6]))).toBe(true);
    engine.play();
    engine.end();

    const output = [new Float32Array(8)];
    const result = engine.process(output);

    expect(Array.from(output[0])).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
      expect.closeTo(0.3),
      expect.closeTo(0.4),
      expect.closeTo(0.5),
      expect.closeTo(0.6),
      0,
      0,
    ]);
    expect(result).toEqual({
      consumedFrames: 6,
      ended: true,
      underrun: false,
    });
  });

  it("deinterleaves stereo PCM without changing channel samples", () => {
    const engine = new PcmStreamEngine({
      capacityFrames: 4,
      channelCount: 2,
      latencyFrames: 0,
    });
    engine.writeInterleaved(new Float32Array([1, 10, 2, 20, 3, 30]));
    engine.play();

    const output = [new Float32Array(3), new Float32Array(3)];
    const result = engine.process(output);

    expect(Array.from(output[0])).toEqual([1, 2, 3]);
    expect(Array.from(output[1])).toEqual([10, 20, 30]);
    expect(result.consumedFrames).toBe(3);
  });

  it("rejects a write atomically when the fixed ring buffer has insufficient capacity", () => {
    const engine = new PcmStreamEngine({
      capacityFrames: 4,
      channelCount: 1,
      latencyFrames: 0,
    });
    expect(engine.writeInterleaved(new Float32Array([1, 2, 3]))).toBe(true);
    expect(engine.writeInterleaved(new Float32Array([4, 5]))).toBe(false);
    engine.play();

    const output = [new Float32Array(4)];
    engine.process(output);

    expect(Array.from(output[0])).toEqual([1, 2, 3, 0]);
  });

  it("pauses without consuming and resumes from the same buffered frame", () => {
    const engine = new PcmStreamEngine({
      capacityFrames: 4,
      channelCount: 1,
      latencyFrames: 0,
    });
    engine.writeInterleaved(new Float32Array([1, 2]));
    engine.play();
    engine.pause();

    const pausedOutput = [new Float32Array(2)];
    expect(engine.process(pausedOutput).consumedFrames).toBe(0);
    expect(Array.from(pausedOutput[0])).toEqual([0, 0]);

    engine.play();
    const resumedOutput = [new Float32Array(2)];
    expect(engine.process(resumedOutput).consumedFrames).toBe(2);
    expect(Array.from(resumedOutput[0])).toEqual([1, 2]);
  });

  it("reports one underrun episode, emits silence, and recovers on the next write", () => {
    const engine = new PcmStreamEngine({
      capacityFrames: 4,
      channelCount: 1,
      latencyFrames: 0,
    });
    engine.play();

    const firstSilence = [new Float32Array(2)];
    expect(engine.process(firstSilence)).toEqual({
      consumedFrames: 0,
      ended: false,
      underrun: true,
    });
    expect(Array.from(firstSilence[0])).toEqual([0, 0]);

    const sameUnderrun = [new Float32Array(2)];
    expect(engine.process(sameUnderrun).underrun).toBe(false);

    engine.writeInterleaved(new Float32Array([0.25, 0.5]));
    const recovered = [new Float32Array(2)];
    expect(engine.process(recovered)).toEqual({
      consumedFrames: 2,
      ended: false,
      underrun: false,
    });
    expect(Array.from(recovered[0])).toEqual([0.25, 0.5]);

    expect(engine.process([new Float32Array(2)]).underrun).toBe(true);
  });

  it("waits for the configured latency threshold before consuming", () => {
    const engine = new PcmStreamEngine({
      capacityFrames: 8,
      channelCount: 1,
      latencyFrames: 4,
    });
    engine.play();
    engine.writeInterleaved(new Float32Array([1, 2, 3]));

    const waiting = [new Float32Array(3)];
    expect(engine.process(waiting).consumedFrames).toBe(0);
    expect(Array.from(waiting[0])).toEqual([0, 0, 0]);

    engine.writeInterleaved(new Float32Array([4]));
    const started = [new Float32Array(4)];
    expect(engine.process(started).consumedFrames).toBe(4);
    expect(Array.from(started[0])).toEqual([1, 2, 3, 4]);
  });
});
