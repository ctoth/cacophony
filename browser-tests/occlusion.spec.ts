import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    runInterruptedOcclusionRenderCheck(): Promise<
      | { supported: false }
      | {
          supported: true;
          render: {
            dryLevel: number;
            expectedGain: number;
            maximumStep: number;
            interruptionGain: number;
            midpointGain: number;
            tailMaximumError: number;
          } | null;
        }
    >;
    runOcclusionRenderCheck(): Promise<
      | { supported: false }
      | { supported: true; lowDb: number; cutoffDb: number; highRatio: number; resetErrors: number[] }
    >;
  }
}

test("interrupts occlusion without a gain jump and smoothly restores the running dry signal", async ({
  page,
  browserName,
}) => {
  await page.goto("/browser-tests/occlusion.html");
  const result = await page.evaluate(() => window.runInterruptedOcclusionRenderCheck());
  test.skip(
    !result.supported && process.platform === "win32" && browserName !== "chromium",
    "OfflineAudioContext unavailable in this browser",
  );
  expect(result.supported).toBe(true);
  if (!result.supported) return;
  test.skip(result.render === null && browserName !== "chromium", "This engine does not expose offline suspend/resume");
  expect(result.render).not.toBeNull();
  if (!result.render) return;
  const render = result.render;
  expect(render.dryLevel).toBeGreaterThan(0.1);
  expect(render.maximumStep).toBeLessThan(0.001);
  expect(render.interruptionGain).toBeCloseTo(render.expectedGain, 2);
  expect(render.midpointGain).toBeCloseTo((render.expectedGain + 1) / 2, 2);
  expect(render.tailMaximumError).toBeLessThan(1e-6);
});

test("native occlusion attenuates and filters, then restores the dry waveform", async ({ page }) => {
  await page.goto("/browser-tests/occlusion.html");
  const result = await page.evaluate(() => window.runOcclusionRenderCheck());
  test.skip(!result.supported && process.platform === "win32", "OfflineAudioContext unavailable in this browser");
  expect(result.supported).toBe(true);
  if (!result.supported) return;
  expect(result.lowDb).toBeCloseTo(-18, 1);
  expect(result.cutoffDb).toBeCloseTo(-21.0103, 1);
  expect(result.highRatio).toBeLessThan(0.002);
  for (const error of result.resetErrors) expect(error).toBeLessThan(1e-6);
});
