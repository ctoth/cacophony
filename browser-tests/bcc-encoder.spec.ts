import { expect, test } from "@playwright/test";

interface BccEncoderRenderResult {
  supported: true;
  peaks: {
    w: number;
    y: number;
    z: number;
    x: number;
    binauralLeft: number;
    binauralRight: number;
  };
}

interface UnsupportedResult {
  supported: false;
  reason: string;
}

declare global {
  interface Window {
    runBccEncoderRenderCheck(): Promise<BccEncoderRenderResult | UnsupportedResult>;
  }
}

test("BCC worklet renders W/Y FOA and feeds the binaural decoder", async ({ page }) => {
  await page.goto("/browser-tests/bcc-encoder.html");

  const result = await page.evaluate(() => window.runBccEncoderRenderCheck());
  test.skip(!result.supported && process.platform === "win32", "Offline AudioWorklet is unavailable in this browser");

  expect(result.supported, result.supported ? undefined : result.reason).toBe(true);
  if (!result.supported) return;

  expect(result.peaks.w).toBeGreaterThan(1e-4);
  expect(result.peaks.y).toBeGreaterThan(1e-4);
  expect(result.peaks.z).toBeLessThan(1e-8);
  expect(result.peaks.x).toBeLessThan(1e-8);
  expect(result.peaks.binauralLeft).toBeGreaterThan(1e-6);
  expect(result.peaks.binauralRight).toBeGreaterThan(1e-6);
});
