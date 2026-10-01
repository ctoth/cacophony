import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    runSpatialSmoothingCheck(): Promise<
      | { supported: false }
      | {
          supported: true;
          modern: boolean;
          listenerCalls: Array<[string, number, number, number]>;
          listenerPose: { position: number[]; orientation: { forward: number[]; up: number[] } };
          initialPan: number;
          render: { expected: number[]; actual: number[]; jumps: number[]; initialRight: number } | null;
        }
    >;
  }
}

test("spatial targets round-trip on modern and legacy native listeners", async ({ page }) => {
  await page.goto("/browser-tests/spatial-smoothing.html");
  const result = await page.evaluate(() => window.runSpatialSmoothingCheck());
  test.skip(!result.supported && process.platform === "win32", "OfflineAudioContext unavailable in this browser");
  expect(result.supported).toBe(true);
  if (!result.supported) return;
  expect(result.initialPan).toBe(-1);
  expect(result.listenerPose).toEqual({ position: [10, 2, 3], orientation: { forward: [1, 0, -1], up: [1, 1, 0] } });
  if (result.modern) {
    expect(result.listenerCalls.map(([key]) => key)).toEqual(["positionX", "forwardX", "upX"]);
    for (const call of result.listenerCalls) expect(call[3]).toBe(0.1);
  }
});

test("native stereo rendering preserves interrupted exponential motion", async ({ page }) => {
  await page.goto("/browser-tests/spatial-smoothing.html");
  const result = await page.evaluate(() => window.runSpatialSmoothingCheck());
  test.skip(!result.supported && process.platform === "win32", "OfflineAudioContext unavailable in this browser");
  expect(result.supported).toBe(true);
  if (!result.supported) return;
  test.skip(
    result.render === null,
    "This engine does not expose offline suspend/resume; native Node rendering covers retargeting",
  );
  if (!result.render) return;
  expect(result.render.initialRight).toBeCloseTo(0, 6);
  for (let i = 0; i < result.render.actual.length; i++) {
    expect(result.render.actual[i]).toBeCloseTo(result.render.expected[i]!, 3);
  }
  for (const jump of result.render.jumps) expect(jump).toBeLessThan(0.0001);
});
