import { expect, test } from "@playwright/test";

interface AudioSpriteRenderResult {
  afterSilent: boolean;
  beforeSilent: boolean;
  positiveOnly: boolean;
  supported: true;
}

interface UnsupportedResult {
  supported: false;
}

declare global {
  interface Window {
    runAudioSpriteRenderCheck(): Promise<AudioSpriteRenderResult | UnsupportedResult>;
  }
}

test("region Sound rendering stays inside its atlas boundaries", async ({ page }) => {
  await page.goto("/browser-tests/sprite.html");

  const result = await page.evaluate(() => window.runAudioSpriteRenderCheck());
  test.skip(!result.supported && process.platform === "win32", "OfflineAudioContext unavailable in this browser");
  expect(result.supported).toBe(true);
  if (!result.supported) return;

  expect(result.beforeSilent).toBe(true);
  expect(result.positiveOnly).toBe(true);
  expect(result.afterSilent).toBe(true);
});
