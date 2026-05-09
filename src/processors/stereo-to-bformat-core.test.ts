import { describe, expect, it } from "vitest";

import { StereoToFoaUpmixer } from "./stereo-to-bformat-core";

function processBlock(
  upmixer: StereoToFoaUpmixer,
  leftValue: (frame: number) => number,
  rightValue: (frame: number) => number,
  frameCount = 256,
) {
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const w = new Float32Array(frameCount);
  const y = new Float32Array(frameCount);
  const z = new Float32Array(frameCount);
  const x = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    left[frame] = leftValue(frame);
    right[frame] = rightValue(frame);
  }

  upmixer.process(left, right, w, y, z, x);
  return { w, y, z, x };
}

function averageAbsolute(values: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += Math.abs(values[i]);
  }
  return sum / values.length;
}

describe("StereoToFoaUpmixer", () => {
  it("keeps mono material in W with negligible horizontal cue", () => {
    const upmixer = new StereoToFoaUpmixer(48_000);
    let block = processBlock(
      upmixer,
      () => 1,
      () => 1,
    );

    for (let i = 0; i < 31; i++) {
      block = processBlock(
        upmixer,
        () => 1,
        () => 1,
      );
    }

    expect(averageAbsolute(block.w)).toBeGreaterThan(0.1);
    expect(averageAbsolute(block.y)).toBeLessThan(1e-4);
    expect(Array.from(block.z)).toEqual(new Array(block.z.length).fill(0));
    expect(Array.from(block.x)).toEqual(new Array(block.x.length).fill(0));
  });

  it("suppresses directional output for low-band hard-panned content after settling", () => {
    const upmixer = new StereoToFoaUpmixer(48_000);
    let block = processBlock(
      upmixer,
      () => 1,
      () => 0,
    );

    for (let i = 0; i < 63; i++) {
      block = processBlock(
        upmixer,
        () => 1,
        () => 0,
      );
    }

    expect(averageAbsolute(block.w)).toBeGreaterThan(0.1);
    expect(averageAbsolute(block.y)).toBeLessThan(0.02);
  });

  it("preserves strong horizontal cue for high-frequency side content", () => {
    const upmixer = new StereoToFoaUpmixer(48_000);
    let block = processBlock(
      upmixer,
      (frame) => (frame % 2 === 0 ? 1 : -1),
      (frame) => (frame % 2 === 0 ? -1 : 1),
    );

    for (let i = 0; i < 15; i++) {
      block = processBlock(
        upmixer,
        (frame) => (frame % 2 === 0 ? 1 : -1),
        (frame) => (frame % 2 === 0 ? -1 : 1),
      );
    }

    expect(averageAbsolute(block.y)).toBeGreaterThan(0.25);
    expect(averageAbsolute(block.w)).toBeLessThan(0.05);
  });
});
