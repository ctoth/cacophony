import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

test("HTML currentTime follows a real network buffering stall", async ({ page, browserName }) => {
  const rate = 24_000;
  // Chromium waits for more startup data than Firefox before accepting play().
  // Both fixtures must begin playback before the withheld suffix is released.
  const seconds = browserName === "chromium" ? 30 : 4;
  const initialSeconds = browserName === "chromium" ? 5 : 1;
  const delayMs = browserName === "chromium" ? 8000 : 4000;
  const split = 44 + rate * 2 * initialSeconds;
  const bytes = Buffer.alloc(44 + rate * 2 * seconds);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < rate * seconds; i++)
    bytes.writeInt16LE(Math.sin((i * 2 * Math.PI * 440) / rate) * 12_000, 44 + i * 2);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": bytes.length,
      "Access-Control-Allow-Origin": "*",
    });
    response.write(bytes.subarray(0, split));
    const timer = setTimeout(() => {
      timers.delete(timer);
      response.end(bytes.subarray(split));
    }, delayMs);
    timers.add(timer);
    response.on("close", () => {
      clearTimeout(timer);
      timers.delete(timer);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await page.goto("/browser-tests/prepare-seek.html");
    const supported = await page.evaluate(() => typeof AudioContext === "function");
    test.skip(!supported && process.platform === "win32", "Windows WebKit does not expose AudioContext");
    expect(supported).toBe(true);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Network stall server did not open");
    const result = await page.evaluate(async (url) => {
      const { Cacophony } = await import("/src/cacophony.ts");
      const context = new AudioContext();
      const engine = new Cacophony(context, undefined, { autoUnlock: false, autoRecover: false, quiet: true });
      const sound = await engine.createSound(url, "html", "stereo");
      try {
        await context.resume();
        const [voice] = sound.preplay();
        const media = voice.source.mediaElement;
        await new Promise<void>((resolve) => {
          voice.on("play", resolve);
          voice.play();
        });
        await new Promise<void>((resolve) => media.addEventListener("waiting", () => resolve(), { once: true }));
        const frozen = media.currentTime,
          clock = context.currentTime;
        while (context.currentTime < clock + 0.2) await new Promise(requestAnimationFrame);
        return {
          frozen,
          actual: media.currentTime,
          observed: voice.currentTime,
          clockAdvance: context.currentTime - clock,
          state: voice.state,
        };
      } finally {
        sound.cleanup();
        engine.dispose();
        await context.close();
      }
    }, `http://127.0.0.1:${address.port}/stall.wav`);
    expect(result.state).toBe("playing");
    expect(result.clockAdvance).toBeGreaterThanOrEqual(0.2);
    expect(result.actual).toBeCloseTo(result.frozen, 2);
    expect(result.observed).toBeCloseTo(result.actual, 2);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
