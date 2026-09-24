import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    runCleanupCheck(scheduled: boolean): Promise<{
      supported: boolean;
      terminated?: boolean;
      bufferPreserved?: boolean;
    }>;
  }
}

for (const scheduled of [false, true]) {
  test(`cleanup terminates a native ${scheduled ? "scheduled" : "immediate"} looping source`, async ({ page }) => {
    await page.goto("/browser-tests/cleanup.html");
    const result = await page.evaluate((scheduled) => window.runCleanupCheck(scheduled), scheduled);
    test.skip(
      !result.supported && process.platform === "win32",
      "The Windows WebKit build does not expose AudioContext",
    );
    expect(result.supported).toBe(true);
    expect(result.terminated).toBe(true);
    expect(result.bufferPreserved).toBe(true);
  });
}
