import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    createLazyReverb(): Promise<boolean>;
  }
}

test("published ESM loads only the requested worklet and leaves MediaBunny unloaded", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/browser-tests/lazy-loading.html");
  await expect.poll(() => page.evaluate(() => typeof window.createLazyReverb)).toBe("function");

  const payloadRequests = () => requests.filter((url) => url.includes("/dist/bundles/"));
  expect(payloadRequests()).toEqual([]);
  expect(requests.filter((url) => url.includes("mediabunny"))).toEqual([]);

  const supported = await page.evaluate(() => typeof AudioContext === "function");
  test.skip(!supported && process.platform === "win32", "AudioContext is unavailable in this Windows browser");
  expect(supported).toBe(true);
  expect(await page.evaluate(() => window.createLazyReverb())).toBe(true);
  expect(payloadRequests()).toHaveLength(1);
  expect(payloadRequests()[0]).toContain("dattorro-reverb");
  expect(requests.filter((url) => url.includes("mediabunny"))).toEqual([]);
});
