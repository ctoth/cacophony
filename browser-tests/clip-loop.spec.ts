import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    clipLoopCheck(mode: string): Promise<{
      supported: boolean;
      interruptedSupported?: boolean;
      ended: number;
      state: string;
      playEvents: number;
      beforeSilent: boolean;
      noSuffix: boolean;
      prefix: boolean;
      loopAudible: boolean;
      afterSilent: boolean;
      continuous: boolean;
      endErrorSeconds?: number;
    }>;
  }
}

for (const mode of [
  "finite",
  "infinite",
  "single",
  "late",
  "sprite",
  "cancel",
  "single-rate",
  "absolute-rate",
  "mode-switch",
]) {
  test(`native ${mode} clip keeps R boundaries without suffix samples or repeated attacks`, async ({ page }) => {
    await page.goto("/browser-tests/clip-loop.html");
    const result = await page.evaluate((mode) => window.clipLoopCheck(mode), mode);
    test.skip(!result.supported && process.platform === "win32", "Windows WebKit does not expose OfflineAudioContext");
    expect(result.supported).toBe(true);
    test.skip(
      result.interruptedSupported === false,
      "Native offline context cannot suspend/resume for a source-mode switch",
    );
    expect(result.beforeSilent, JSON.stringify(result)).toBe(true);
    expect(result.noSuffix, JSON.stringify(result)).toBe(true);
    expect(result.afterSilent, JSON.stringify(result)).toBe(true);
    expect(result.continuous, JSON.stringify(result)).toBe(true);
    if (mode === "single-rate" || mode === "absolute-rate")
      expect(result.endErrorSeconds, JSON.stringify(result)).toBeLessThan(0.01);
    expect(result.playEvents).toBe(1);
    expect(result.prefix).toBe(!["cancel", "late", "single-rate", "absolute-rate"].includes(mode));
    expect(result.loopAudible).toBe(mode !== "cancel");
    expect(result.ended).toBe(mode === "infinite" ? 0 : 1);
    expect(result.state).toBe(mode === "infinite" ? "playing" : "stopped");
  });
}
