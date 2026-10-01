import { expect, test } from "@playwright/test";
import type { Cacophony } from "../src/cacophony";
import type { AudioSinkId } from "../src/context";
import type { DeviceChangeEvent } from "../src/events";

declare global {
  interface Window {
    audioSession: {
      supported: boolean;
      ready: boolean;
      context: AudioContext & { setSinkId?: (id: AudioSinkId) => Promise<void> };
      cacophony: Cacophony;
      events: string[];
      devices: DeviceChangeEvent[];
      sink?: AudioSinkId;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto("/browser-tests/session.html");
  const supported = await page.evaluate(() => window.audioSession.supported);
  test.skip(!supported && process.platform === "win32", "Windows WebKit does not expose AudioContext");
  expect(supported).toBe(true);
  await page.locator("#start").click();
  await page.waitForFunction(() => window.audioSession.ready);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const session = window.audioSession;
    session?.cacophony?.dispose();
    await session?.context?.close();
  });
});

test("explicit and external transitions emit once and platform suspension recovers", async ({ page }) => {
  await page.evaluate(() => window.audioSession.cacophony.pause());
  await expect.poll(() => page.evaluate(() => window.audioSession.events)).toEqual(["suspend"]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await page.evaluate(() => window.audioSession.context.state)).toBe("suspended");
  await page.evaluate(() => window.audioSession.cacophony.resume());
  await expect.poll(() => page.evaluate(() => window.audioSession.events)).toEqual(["suspend", "resume"]);
  await page.evaluate(() => window.audioSession.context.suspend());
  await expect
    .poll(() => page.evaluate(() => window.audioSession.events))
    .toEqual(["suspend", "resume", "suspend", "resume"]);
  expect(await page.evaluate(() => window.audioSession.context.state)).toBe("running");
});

test("native mediaDevices dispatch reaches the device-list event", async ({ page }) => {
  expect(await page.evaluate(() => typeof navigator.mediaDevices?.enumerateDevices)).toBe("function");
  await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event("devicechange")));
  await expect.poll(() => page.evaluate(() => window.audioSession.devices.length)).toBe(1);
  const event = await page.evaluate(() => {
    const { devices, timestamp } = window.audioSession.devices[0];
    return { kinds: devices.map((device) => device.kind), timestamp };
  });
  expect(event.kinds.every((kind) => kind === "audiooutput")).toBe(true);
  expect(event.timestamp).toBeGreaterThan(0);
});

test("selects a silent sink on supported native contexts", async ({ page, browserName }) => {
  const supported = await page.evaluate(() => typeof window.audioSession.context.setSinkId === "function");
  if (browserName === "chromium") expect(supported).toBe(true);
  test.skip(!supported, "The native context does not support output device selection");
  await page.evaluate(() => window.audioSession.cacophony.setOutputDevice({ type: "none" }));
  // AudioSinkInfo.type is a prototype getter, so read it before serialization.
  expect(
    await page.evaluate(() => {
      const sink = window.audioSession.cacophony.outputDevice;
      return typeof sink === "object" ? sink.type : sink;
    }),
  ).toBe("none");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sink = window.audioSession.sink;
        return typeof sink === "object" ? sink.type : sink;
      }),
    )
    .toBe("none");
});
