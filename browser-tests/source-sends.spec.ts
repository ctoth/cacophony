import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    renderSourceSend(
      mode: "linear" | "exponential" | "remove",
    ): Promise<
      | { supported: false }
      | { supported: true; initial: number; midpoint: number; tailMaximum: number; maximum: number }
    >;
  }
}

for (const mode of ["linear", "exponential", "remove"] as const) {
  test(`native source send ${mode}`, async ({ page }) => {
    await page.goto("/browser-tests/source-sends.html");
    const result = await page.evaluate((mode) => window.renderSourceSend(mode), mode);
    test.skip(!result.supported && process.platform === "win32", "OfflineAudioContext unavailable in this browser");
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    if (mode === "remove") {
      expect(result.maximum).toBe(0);
    } else {
      expect(result.initial).toBeGreaterThan(0.1);
      expect(result.midpoint / result.initial).toBeCloseTo(mode === "linear" ? 0.5 : 0.01, 5);
      expect(result.tailMaximum).toBe(0);
    }
  });
}
