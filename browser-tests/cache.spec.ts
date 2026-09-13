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
      const url = (mode.startsWith('cors') ? ${JSON.stringify(corsOrigin)} : location.origin) + '/audio/' + mode;
      const first = await cache.getAudioBuffer(context, url);
      const second = await cache.getAudioBuffer(context, url);
      if (mode === 'cors-browser') await caches.delete('audio-cache-v2');
      if (mode === 'validate' || mode === 'private' || mode === 'cors' || mode.endsWith('validate') || mode === 'cors-browser' || mode === 'cors-age' || mode === 'cors-no-store-update') {
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
      const mode = path
        .split("/")
        .at(-1)
        ?.replace(/^control-/, "");
      const headers: Record<string, string> = {
        "content-type": "audio/wav",
        "access-control-allow-origin": "*",
        "cache-control": mode?.endsWith("no-store") ? "no-store" : "private, max-age=60",
      };
      if (mode?.endsWith("validate")) {
        headers.etag = '"one"';
        headers["cache-control"] = count === 1 ? "no-cache" : "max-age=60";
      }
      if (mode === "cors") {
        // These headers exist at the origin but are NOT exposed to JavaScript.
        headers.vary = "Accept-Language";
        headers.age = "59";
      }
      if (mode === "cors-validate") {
        // Last-Modified is visible without Expose-Headers. Manually adding
        // If-Modified-Since would trigger OPTIONS, which this server rejects.
        headers["last-modified"] = "Mon, 01 Sep 2025 00:00:00 GMT";
      }
      if (mode === "cors-exposed-validate") {
        // Even a visible ETag must be validated by Fetch, not by adding
        // If-None-Match ourselves: this origin rejects all preflights.
        headers["access-control-expose-headers"] = "ETag";
      }
      if (mode === "cors-no-store-update") {
        headers["cache-control"] = count === 1 ? "no-cache" : "no-store";
      }
      if (mode === "cors-age") {
        headers["access-control-expose-headers"] = "Age";
        headers.age = count === 1 ? "60" : "0";
      }
      if (mode === "cors-vary") {
        headers["access-control-expose-headers"] = "Vary";
        headers.vary = "Cookie";
      }
      if (request.method === "OPTIONS") {
        response.writeHead(403);
        response.end();
        return;
      }
      const validated = mode?.endsWith("validate") && request.headers["if-none-match"] === '"one"';
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

for (const mode of [
  "no-store",
  "validate",
  "private",
  "cors",
  "cors-no-store",
  "cors-validate",
  "cors-exposed-validate",
  "cors-no-store-update",
  "cors-browser",
  "cors-age",
  "cors-vary",
]) {
  test(`HTTP cache: ${mode}`, async ({ page }) => {
    requests.delete(`/audio/${mode}`);
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.checkAudioCache === "function");
    const result = await page.evaluate((selected) => window.checkAudioCache(selected), mode);
    // WebKit's ephemeral contexts may not reuse their HTTP cache. Compare to
    // ordinary Fetch in the same context rather than assuming disk caching.
    let browserRequests = 1;
    if (mode === "cors-browser" || mode === "cors-vary") {
      const path = `/audio/control-${mode}`;
      requests.delete(path);
      await page.evaluate(async (url) => {
        await (await fetch(url)).arrayBuffer();
        await (await fetch(url)).arrayBuffer();
      }, corsOrigin + path);
      browserRequests = requests.get(path) ?? 0;
      expect(browserRequests).toBeGreaterThan(0);
    }
    if (mode.endsWith("no-store")) {
      expect(result).toEqual({ same: false, decodes: 2, stored: 0 });
      expect(requests.get(`/audio/${mode}`)).toBe(2);
    } else if (mode === "cors-no-store-update") {
      // The second load must evict the previously retained body and policy;
      // clearing memory before the third load checks persistent eviction too.
      expect(result).toEqual({ same: false, decodes: 3, stored: 0 });
      expect(requests.get(`/audio/${mode}`)).toBe(3);
    } else if (mode === "cors-validate" || mode === "cors-exposed-validate" || mode === "cors-age") {
      expect(result).toEqual({ same: false, decodes: 3, stored: 1 });
      expect(requests.get(`/audio/${mode}`)).toBe(2);
    } else if (mode === "cors-vary") {
      expect(result).toEqual({ same: false, decodes: 2, stored: 0 });
      expect(requests.get(`/audio/${mode}`)).toBe(browserRequests);
    } else {
      expect(result).toEqual({ same: true, decodes: 2, stored: 1 });
      expect(requests.get(`/audio/${mode}`)).toBe(mode === "validate" ? 2 : browserRequests);
    }
  });
}
