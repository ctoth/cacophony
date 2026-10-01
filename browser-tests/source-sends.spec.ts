import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    renderInterruptedSourceSend(type: "linear" | "exponential"): Promise<
      | { supported: false }
      | {
          supported: true;
          render: {
            fullLevel: number;
            expectedGain: number;
            maximumStep: number;
            interruptionGain: number;
            midpointGain: number;
            finalGain: number;
          } | null;
        }
    >;
    renderSourceSend(
      mode: "linear" | "exponential" | "remove",
    ): Promise<
      | { supported: false }
      | { supported: true; initial: number; midpoint: number; tailMaximum: number; maximum: number }
    >;
  }
}

for (const type of ["linear", "exponential"] as const) {
  test(`interrupts the ${type} source send ramp without a gain jump`, async ({ page, browserName }) => {
    await page.goto("/browser-tests/source-sends.html");
    const result = await page.evaluate((type) => window.renderInterruptedSourceSend(type), type);
    test.skip(
      !result.supported && process.platform === "win32" && browserName !== "chromium",
      "OfflineAudioContext unavailable in this browser",
    );
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    test.skip(
      result.render === null && browserName !== "chromium",
      "This engine does not expose offline suspend/resume",
    );
    expect(result.render).not.toBeNull();
    if (!result.render) return;
    const render = result.render;
    expect(render.fullLevel).toBeGreaterThan(0.1);
    expect(render.maximumStep).toBeLessThan(0.001);
    expect(render.interruptionGain).toBeCloseTo(render.expectedGain, 3);
    expect(render.midpointGain).toBeCloseTo((render.expectedGain + 1) / 2, 3);
    expect(render.finalGain).toBeCloseTo(1, 5);
  });
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
