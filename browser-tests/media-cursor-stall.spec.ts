import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

test("HTML currentTime follows a real network buffering stall", async ({ page, browserName }) => {
  const rate = 24_000;
  // Different native demuxers need different amounts of startup data. Retain
  // the withheld middle until cleanup, while serving small range probes so
  // WebKit can inspect the WAV header/tail before accepting progressive play.
  const seconds = browserName === "firefox" ? 4 : 30;
  const initialSeconds = browserName === "firefox" ? 1 : 5;
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
  const server = createServer((request, response) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
    if (start > end || start >= bytes.length) {
      response.writeHead(416);
      response.end();
      return;
    }
    response.writeHead(range ? 206 : 200, {
      "Content-Type": "audio/wav",
      "Content-Length": end - start + 1,
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
    });
    if (end < split || start >= bytes.length - 8192) response.end(bytes.subarray(start, end + 1));
    else if (start < split) response.write(bytes.subarray(start, split));
    else response.flushHeaders();
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
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
