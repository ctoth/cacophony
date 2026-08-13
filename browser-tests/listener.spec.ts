import { expect, test } from "@playwright/test";

interface ListenerCompatibilityResult {
  capability: "legacy" | "modern";
  coreFactoryCount: number;
  forward: [number, number, number];
  orientation: {
    forward: [number, number, number];
    up: [number, number, number];
  };
  position: [number, number, number];
  supported: true;
  up: [number, number, number];
}

interface UnsupportedResult {
  supported: false;
}

declare global {
  interface Window {
    runListenerCompatibilityCheck(): Promise<ListenerCompatibilityResult | UnsupportedResult>;
  }
}

test("listener pose setters round-trip on the native AudioContext", async ({ page }) => {
  await page.goto("/browser-tests/listener.html");

  const result = await page.evaluate(() => window.runListenerCompatibilityCheck());
  test.skip(!result.supported && process.platform === "win32", "The Windows WebKit build does not expose AudioContext");

  expect(result.supported, "CI browser builds must expose AudioContext").toBe(true);

  if (!result.supported) {
    return;
  }

  expect(["legacy", "modern"]).toContain(result.capability);
  expect(result.coreFactoryCount).toBe(8);
  expect(result.forward).toEqual([0, 1, 0]);
  expect(result.up).toEqual([0, 0, 1]);
  expect(result.orientation).toEqual({
    forward: [0, 1, 0],
    up: [0, 0, 1],
  });
  expect(result.position).toEqual([4, 5, 6]);
});
