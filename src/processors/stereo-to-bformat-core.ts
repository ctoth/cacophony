const SQRT1_2 = Math.SQRT1_2;

export function encodeStereoToBFormat(
  left: Float32Array,
  right: Float32Array,
  w: Float32Array,
  x: Float32Array,
  y: Float32Array,
  z: Float32Array,
): void {
  const frameCount = Math.min(left.length, right.length, w.length, x.length, y.length, z.length);

  for (let frame = 0; frame < frameCount; frame++) {
    const l = left[frame];
    const r = right[frame];
    w[frame] = (l + r) * SQRT1_2;
    x[frame] = 0;
    y[frame] = (l - r) * SQRT1_2;
    z[frame] = 0;
  }
}
