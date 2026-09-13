import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";

let origin: string;
let corsOrigin: string;
const servers: Server[] = [];
const requests = new Map<string, number>();

declare global {
  interface Window {
    checkAudioCache(mode: string): Promise<{ same: boolean; decodes: number; stored: number }>;
  }
}

test.beforeAll(async () => {
  const html = () => `<!doctype html><title>HTTP audio cache</title><script type="module">
    import { AudioCache } from 'http://127.0.0.1:4173/src/cache.ts';
    window.checkAudioCache = async mode => {
      const cache = new AudioCache();
      let decodes = 0;
      // Exercise real Fetch and Cache API without depending on platform audio hardware.
      const context = { decodeAudioData: async bytes => ({
        length: bytes.byteLength, numberOfChannels: 1, duration: 1, sampleRate: 48000, id: ++decodes
      }) };
      const url = (mode === 'cors' ? ${JSON.stringify(corsOrigin)} : location.origin) + '/audio/' + mode;
      const first = await cache.getAudioBuffer(context, url);
      const second = await cache.getAudioBuffer(context, url);
      if (mode === 'validate' || mode === 'private') {
        cache.clearMemoryCache();
        await cache.getAudioBuffer(context, url);
      }
      const storage = await caches.open('audio-cache-v2');
      return { same: first === second, decodes, stored: (await storage.keys()).length };
    };
  </script>`;
  for (let i = 0; i < 2; i++) {
    const server = createServer((request, response) => {
      const path = request.url ?? "/";
      if (path === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(html());
        return;
      }
      const count = (requests.get(path) ?? 0) + 1;
      requests.set(path, count);
      const mode = path.split("/").at(-1);
      const headers: Record<string, string> = {
        "content-type": "audio/wav",
        "access-control-allow-origin": "*",
        "cache-control": mode === "no-store" ? "no-store" : "private, max-age=60",
      };
      if (mode === "validate") {
        headers.etag = '"one"';
        headers["cache-control"] = count === 1 ? "no-cache" : "max-age=60";
      }
      if (mode === "cors") {
        // These headers exist at the origin but are NOT exposed to JavaScript.
        headers.vary = "Accept-Language";
        headers.age = "59";
      }
      const validated = mode === "validate" && request.headers["if-none-match"] === '"one"';
      response.writeHead(validated ? 304 : 200, headers);
      response.end(validated ? undefined : new Uint8Array([1, 2, 3, 4]));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server address");
    if (i === 0) origin = `http://127.0.0.1:${address.port}`;
    else corsOrigin = `http://127.0.0.1:${address.port}`;
  }
});

test.afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

for (const mode of ["no-store", "validate", "private", "cors"]) {
  test(`HTTP cache: ${mode}`, async ({ page }) => {
    requests.delete(`/audio/${mode}`);
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.checkAudioCache === "function");
    const result = await page.evaluate((selected) => window.checkAudioCache(selected), mode);
    if (mode === "no-store" || mode === "cors") {
      expect(result).toEqual({ same: false, decodes: 2, stored: 0 });
      expect(requests.get(`/audio/${mode}`)).toBe(2);
    } else {
      expect(result).toEqual({ same: true, decodes: 2, stored: 1 });
      expect(requests.get(`/audio/${mode}`)).toBe(mode === "validate" ? 2 : 1);
    }
  });
}
