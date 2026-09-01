import { expect, test } from "@playwright/test";

interface ScheduledBufferRenderResult {
  firstAudibleFrame: number;
  gapless: boolean;
  startFrame: number;
  supported: true;
}

interface UnsupportedResult {
  supported: false;
}

declare global {
  interface Window {
    runScheduledBufferRenderCheck(): Promise<ScheduledBufferRenderResult | UnsupportedResult>;
  }
}

test("play({ at }) renders adjacent clips at sample-accurate positions", async ({ page }) => {
  await page.goto("/browser-tests/scheduling.html");

  const result = await page.evaluate(() => window.runScheduledBufferRenderCheck());
  test.skip(!result.supported && process.platform === "win32", "OfflineAudioContext unavailable in this browser");
  expect(result.supported).toBe(true);
  if (!result.supported) {
    return;
  }

  expect(result.firstAudibleFrame).toBeGreaterThanOrEqual(result.startFrame - 1);
  expect(result.firstAudibleFrame).toBeLessThanOrEqual(result.startFrame + 1);
  expect(result.gapless).toBe(true);
});
