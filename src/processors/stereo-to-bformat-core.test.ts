import { describe, expect, it } from "vitest";

import { encodeStereoToBFormat } from "./stereo-to-bformat-core";

// Outputs are Float32Arrays; round-trip the expected double-precision
// values through Float32Array so the comparison is in the same precision.
const f32 = (values: number[]): number[] => Array.from(new Float32Array(values));

describe("encodeStereoToBFormat", () => {
  it("encodes stereo left/right channels into ACN FOA order W, Y, Z, X", () => {
    const left = new Float32Array([1, 0.5, -0.5]);
    const right = new Float32Array([0, -0.5, -0.5]);
    const w = new Float32Array(3);
    const y = new Float32Array(3);
    const z = new Float32Array(3);
    const x = new Float32Array(3);

    encodeStereoToBFormat(left, right, w, y, z, x);

    expect(Array.from(w)).toEqual(
      f32([(1 + 0) * Math.SQRT1_2, (0.5 + -0.5) * Math.SQRT1_2, (-0.5 + -0.5) * Math.SQRT1_2]),
    );
    expect(Array.from(y)).toEqual(
      f32([(1 - 0) * Math.SQRT1_2, (0.5 - -0.5) * Math.SQRT1_2, (-0.5 - -0.5) * Math.SQRT1_2]),
    );
    expect(Array.from(z)).toEqual([0, 0, 0]);
    expect(Array.from(x)).toEqual([0, 0, 0]);
  });
});
