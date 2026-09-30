import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    runOcclusionRenderCheck(): Promise<
      | { supported: false }
      | { supported: true; lowDb: number; cutoffDb: number; highRatio: number; resetErrors: number[] }
    >;
  }
}

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
