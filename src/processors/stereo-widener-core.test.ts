import { describe, expect, it } from "vitest";

import { buildDecorrelatorTaps, StereoWidenerCore } from "./stereo-widener-core";

function correlation(a: number[], b: number[]): number {
  const meanA = a.reduce((sum, x) => sum + x, 0) / a.length;
  const meanB = b.reduce((sum, x) => sum + x, 0) / b.length;
  let cross = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    cross += x * y;
    energyA += x * x;
    energyB += y * y;
  }
  return cross / Math.sqrt(energyA * energyB);
}

describe("velvet-noise stereo widener", () => {
  it("builds deterministic sparse signed decorrelation filters", () => {
    const a = buildDecorrelatorTaps(48000, 123);
    const b = buildDecorrelatorTaps(48000, 123);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    expect(a.some((tap) => tap.gain < 0)).toBe(true);
    expect(a.some((tap) => tap.gain > 0)).toBe(true);
  });

  it("turns a correlated mono stream into low-correlation stereo", () => {
    const core = new StereoWidenerCore(48000);
    const left: number[] = [];
    const right: number[] = [];
    let random = 0x12345678;
    for (let i = 0; i < 12000; i++) {
      random = (1664525 * random + 1013904223) >>> 0;
      const input = random / 0x80000000 - 1;
      const [l, r] = core.processSample(input, input, { width: 1, decorrelation: 1, transientProtection: 0 });
      if (i > 1500) {
        left.push(l);
        right.push(r);
      }
    }
    expect(Math.abs(correlation(left, right))).toBeLessThan(0.25);
    expect(left.reduce((sum, x) => sum + x * x, 0)).toBeGreaterThan(100);
  });

  it("width zero is a bit-exact bypass", () => {
    const core = new StereoWidenerCore(48000);
    const [left, right] = core.processSample(0.25, -0.5, { width: 0, decorrelation: 1, transientProtection: 1 });
    expect(left).toBe(0.25);
    expect(right).toBe(-0.5);
  });

  it("transient protection keeps an onset on the direct path", () => {
    const protectedCore = new StereoWidenerCore(48000);
    const unprotectedCore = new StereoWidenerCore(48000);
    const protectedOut = protectedCore.processSample(1, 1, { width: 1, decorrelation: 1, transientProtection: 1 });
    const unprotectedOut = unprotectedCore.processSample(1, 1, { width: 1, decorrelation: 1, transientProtection: 0 });
    expect(protectedOut[0]).toBeGreaterThan(0.9);
    expect(Math.abs(unprotectedOut[0])).toBeLessThan(0.01);
  });
});
