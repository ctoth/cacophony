import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    prepareSeekCheck(cancelMode?: "abort" | "cleanup"): Promise<{
      offset: number;
      mediaOffset?: number;
      paused: boolean;
      state: string;
      playEvents: number;
      silentPeak?: number;
      playingPeak?: number;
      playOffset?: number;
      afterPlayEvents?: number;
      error?: string;
    }>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/browser-tests/prepare-seek.html");
  const supported = await page.evaluate(() => typeof AudioContext === "function");
  test.skip(!supported && process.platform === "win32", "Windows WebKit does not expose AudioContext");
  expect(supported).toBe(true);
});

test("native HTML media prepares silently and explicit play starts at the prepared position", async ({ page }) => {
  const result = await page.evaluate(() => window.prepareSeekCheck());
  expect(result.paused).toBe(true);
  expect(result.state).toBe("unplayed");
  expect(result.offset).toBe(1.5);
  expect(result.mediaOffset).toBeCloseTo(1.5, 2);
  expect(result.playEvents).toBe(0);
  expect(result.silentPeak).toBe(0);
  expect(result.playingPeak).toBeGreaterThan(0.01);
  expect(result.playOffset).toBeGreaterThanOrEqual(1.5);
  expect(result.playOffset).toBeLessThan(2.5);
  expect(result.afterPlayEvents).toBe(1);
});

for (const mode of ["abort", "cleanup"] as const) {
  test(`${mode} cancels native preparation without stale playback`, async ({ page }) => {
    const result = await page.evaluate((mode) => window.prepareSeekCheck(mode), mode);
    expect(result.error).toBe("AbortError");
    expect(result.playEvents).toBe(0);
    expect(result.paused).toBe(true);
    expect(result.offset).toBe(0);
    expect(result.state).toBe(mode === "cleanup" ? "stopped" : "unplayed");
  });
}
