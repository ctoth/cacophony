import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCache } from "./cache";
import { audioContextMock } from "./setupTests";

describe("AudioCache HTTP policy", () => {
  const url = "https://example.test/audio.wav";
  let cache: AudioCache;
  let entries: Map<string, Response>;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    cache = new AudioCache();
    entries = new Map();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", {
      delete: vi.fn().mockResolvedValue(false),
      open: async () => ({
        match: async (request: Request | string) =>
          entries.get(typeof request === "string" ? request : request.url)?.clone(),
        put: async (request: Request | string, response: Response) => {
          entries.set(typeof request === "string" ? request : request.url, response.clone());
        },
        delete: async (request: Request | string) =>
          entries.delete(typeof request === "string" ? request : request.url),
      }),
    });
    vi.spyOn(audioContextMock, "decodeAudioData").mockImplementation(
      async () => new AudioBuffer({ length: 4, sampleRate: 48000 }),
    );
    AudioCache.setCacheExpirationTime(86400000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    AudioCache.setCacheExpirationTime(86400000);
  });

  function respond(headers: Record<string, string> = {}) {
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { headers }));
  }

  it.each([
    { shared: false, throws: false },
    { shared: true, throws: false },
    { shared: true, throws: true },
  ])("reports cancellation once to the cancelled subscriber: %j", async ({ shared, throws }) => {
    let finishFetch!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishFetch = resolve;
        }),
    );
    const controller = new AbortController();
    const onLoadingError = vi.fn(() => {
      if (throws) throw new Error("Observer failed");
    });
    const cancelledCallbacks = {
      onLoadingStart: vi.fn(),
      onLoadingProgress: vi.fn(),
      onLoadingComplete: vi.fn(),
      onLoadingError,
    };
    const remainingCallbacks = { onLoadingComplete: vi.fn(), onLoadingError: vi.fn() };
    const cancelled = cache.getAudioBuffer(audioContextMock, url, controller.signal, cancelledCallbacks);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    const remaining = shared ? cache.getAudioBuffer(audioContextMock, url, undefined, remainingCallbacks) : undefined;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    controller.abort();
    await rejected;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(!shared);
    finishFetch(new Response(new Uint8Array([1, 2, 3, 4])));
    if (remaining) {
      await expect(remaining).resolves.toBeInstanceOf(AudioBuffer);
      expect(remainingCallbacks.onLoadingComplete).toHaveBeenCalledTimes(1);
    }
    // Allow the abandoned shared operation's rejection handler to finish too.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cancelledCallbacks.onLoadingStart).toHaveBeenCalledTimes(1);
    expect(onLoadingError).toHaveBeenCalledExactlyOnceWith({
      url,
      error: expect.objectContaining({ name: "AbortError", message: "Operation was aborted" }),
      errorType: "abort",
      timestamp: expect.any(Number),
    });
    expect(cancelledCallbacks.onLoadingProgress).not.toHaveBeenCalled();
    expect(cancelledCallbacks.onLoadingComplete).not.toHaveBeenCalled();
    expect(remainingCallbacks.onLoadingError).not.toHaveBeenCalled();
  });

  it.each([
    { revalidate: false, keepMemory: false },
    { revalidate: true, keepMemory: false },
    { revalidate: true, keepMemory: true },
  ])("recovers from unreadable persistent bodies: %j", async ({ revalidate, keepMemory }) => {
    respond({ "cache-control": revalidate ? "no-cache" : "max-age=60", etag: '"one"' });
    const first = await cache.getAudioBuffer(audioContextMock, url);
    if (!keepMemory) cache.clearMemoryCache();
    const stored = entries.get(url);
    if (!stored) throw new Error("Missing stored representation");
    const readError = new Error("Persistent storage I/O failure");
    vi.spyOn(stored, "clone").mockImplementation(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(readError);
            },
          }),
          { headers: stored.headers },
        ),
    );
    if (revalidate) {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"one"' } }));
    }
    const replacement = new Uint8Array([5, 6, 7, 8]);
    fetchMock.mockImplementationOnce(async () => {
      expect(entries.has(url)).toBe(false);
      return new Response(replacement, { headers: { "cache-control": "max-age=60", etag: '"two"' } });
    });
    const callbacks = { onCacheError: vi.fn(), onLoadingError: vi.fn(), onCacheHit: vi.fn() };
    const recovered = await cache.getAudioBuffer(audioContextMock, url, undefined, callbacks);
    expect(recovered).not.toBe(first);
    expect(callbacks.onCacheError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ url, error: readError, operation: "get" }),
    );
    expect(callbacks.onLoadingError).not.toHaveBeenCalled();
    expect(callbacks.onCacheHit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(revalidate ? 3 : 2);
    const recoveryRequest = fetchMock.mock.calls.at(-1)?.[1];
    expect(new Headers(recoveryRequest?.headers).has("if-none-match")).toBe(false);
    if (revalidate) {
      expect(recoveryRequest?.cache).toBe("reload");
      expect(recoveryRequest?.signal).toBe(fetchMock.mock.calls[1]?.[1]?.signal);
    }
    expect(audioContextMock.decodeAudioData).toHaveBeenLastCalledWith(replacement.buffer);
    cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(revalidate ? 3 : 2);
    expect(entries.get(url)?.headers.get("etag")).toBe('"two"');
  });

  it.each([true, false])("does not retain no-store responses (persistent cache: %s)", async (persistent) => {
    if (!persistent) vi.stubGlobal("caches", undefined);
    respond({ "cache-control": "no-store" });
    respond({ "cache-control": "no-store" });
    const first = await cache.getAudioBuffer(audioContextMock, url);
    const second = await cache.getAudioBuffer(audioContextMock, url);
    expect(second).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(entries.size).toBe(0);
  });

  it.each([
    true,
    false,
  ])("expires memory hits without falling back to TTL (persistent cache: %s)", async (persistent) => {
    if (!persistent) vi.stubGlobal("caches", undefined);
    respond({ "cache-control": "max-age=1" });
    respond({ "cache-control": "max-age=1" });
    const first = await cache.getAudioBuffer(audioContextMock, url);
    vi.setSystemTime(Date.now() + 2000);
    expect(await cache.getAudioBuffer(audioContextMock, url)).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accounts for Age before serving a decoded memory hit", async () => {
    respond({ "cache-control": "max-age=60", age: "59" });
    respond({ "cache-control": "max-age=60" });
    await cache.getAudioBuffer(audioContextMock, url);
    vi.setSystemTime(Date.now() + 2000);
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("revalidates no-cache memory entries and reuses their decoded buffer after a matching 304", async () => {
    respond({ "cache-control": "no-cache", etag: '"one"' });
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { etag: '"one"', "cache-control": "max-age=60" } }),
    );
    const first = await cache.getAudioBuffer(audioContextMock, url);
    expect(await cache.getAudioBuffer(audioContextMock, url)).toBe(first);
    expect(await cache.getAudioBuffer(audioContextMock, url)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("if-none-match")).toBe('"one"');
    expect(audioContextMock.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it.each([
    false,
    true,
  ])("reports conditional hits and only completes newly decoded 304 loads (clear memory: %s)", async (clearMemory) => {
    respond({ "cache-control": "no-cache", etag: '"one"' });
    const first = await cache.getAudioBuffer(audioContextMock, url);
    if (clearMemory) cache.clearMemoryCache();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"one"' } }));
    const callbacks = { onLoadingComplete: vi.fn(), onCacheHit: vi.fn(), onLoadingError: vi.fn() };
    const second = await cache.getAudioBuffer(audioContextMock, url, undefined, callbacks);
    expect(second === first).toBe(!clearMemory);
    expect(callbacks.onCacheHit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ url, cacheType: "conditional" }),
    );
    expect(callbacks.onLoadingComplete).toHaveBeenCalledTimes(clearMemory ? 1 : 0);
    if (clearMemory) {
      expect(callbacks.onLoadingComplete).toHaveBeenCalledWith(expect.objectContaining({ url, size: 4 }));
    }
    expect(callbacks.onLoadingError).not.toHaveBeenCalled();
    expect(audioContextMock.decodeAudioData).toHaveBeenCalledTimes(clearMemory ? 2 : 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("revalidates mixed-case no-cache directives (clear memory: %s)", async (clearMemory) => {
    respond({ "cache-control": 'No-Cache, max-age=60, Extension="Mixed,Case"', etag: '"one"' });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"one"' } }));
    await cache.getAudioBuffer(audioContextMock, url);
    if (clearMemory) cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("if-none-match")).toBe('"one"');
    const metadata = JSON.parse(entries.get(url)?.headers.get("x-cacophony-cache-policy") ?? "null");
    expect(metadata.policyHeaders["cache-control"]).toContain('extension="Mixed,Case"');
  });

  it("honors mixed-case no-store on revalidation", async () => {
    respond({ "cache-control": "no-cache", etag: '"one"' });
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { etag: '"one"', "cache-control": "No-Store, Max-Age=60" } }),
    );
    respond({ "cache-control": "No-Store" });
    await cache.getAudioBuffer(audioContextMock, url);
    await cache.getAudioBuffer(audioContextMock, url);
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(entries.size).toBe(0);
  });

  it("does not revalidate a fresh must-revalidate entry", async () => {
    respond({ "cache-control": "max-age=60, must-revalidate" });
    await cache.getAudioBuffer(audioContextMock, url);
    cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors a new no-store directive on 304 and removes both retained layers", async () => {
    respond({ etag: '"one"' });
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { etag: '"one"', "cache-control": "no-store" } }),
    );
    respond({ "cache-control": "no-store" });
    await cache.getAudioBuffer(audioContextMock, url);
    await cache.getAudioBuffer(audioContextMock, url);
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(entries.size).toBe(0);
  });

  it.each(["*", "cookie", "accept-language"])("does not reuse an unobservable Vary dimension: %s", async (vary) => {
    respond({ "cache-control": "max-age=3600", vary });
    respond({ "cache-control": "max-age=3600", vary });
    await cache.getAudioBuffer(audioContextMock, url);
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    true,
    false,
  ])("revalidates stale must-revalidate rather than serving stale (persistent: %s)", async (persistent) => {
    if (!persistent) vi.stubGlobal("caches", undefined);
    respond({ "cache-control": "max-age=1, must-revalidate", etag: '"one"' });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"one"' } }));
    const first = await cache.getAudioBuffer(audioContextMock, url);
    vi.setSystemTime(Date.now() + 2000);
    expect(await cache.getAudioBuffer(audioContextMock, url)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fall back to stale data when required validation fails", async () => {
    respond({ "cache-control": "max-age=0, must-revalidate", etag: '"one"' });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await cache.getAudioBuffer(audioContextMock, url);
    await expect(cache.getAudioBuffer(audioContextMock, url)).rejects.toThrow("offline");
  });

  it.each([
    "private, max-age=60",
    "private, max-age=60, s-maxage=0",
    'max-age="60"',
  ])("uses private-cache freshness: %s", async (directive) => {
    respond({ "cache-control": directive });
    const first = await cache.getAudioBuffer(audioContextMock, url);
    expect(await cache.getAudioBuffer(audioContextMock, url)).toBe(first);
    cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves Age and expiry across cache serialization", async () => {
    respond({ "cache-control": "max-age=60", age: "58" });
    respond({ "cache-control": "max-age=60" });
    await cache.getAudioBuffer(audioContextMock, url);
    vi.setSystemTime(Date.now() + 1000);
    cache = new AudioCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 2000);
    cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses configured TTL only for responses without explicit policy or validators", async () => {
    AudioCache.setCacheExpirationTime(2000);
    respond();
    respond();
    const first = await cache.getAudioBuffer(audioContextMock, url);
    vi.setSystemTime(Date.now() + 1000);
    expect(await cache.getAudioBuffer(audioContextMock, url)).toBe(first);
    vi.setSystemTime(Date.now() + 2000);
    expect(await cache.getAudioBuffer(audioContextMock, url)).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { initial: 2000, next: 10000, clearMemory: false },
    { initial: 2000, next: 10000, clearMemory: true },
    { initial: 10000, next: 2000, clearMemory: false },
    { initial: 10000, next: 2000, clearMemory: true },
  ])("applies TTL changes to new representations without rewriting existing policy: %j", async ({
    initial,
    next,
    clearMemory,
  }) => {
    AudioCache.setCacheExpirationTime(initial);
    respond();
    await cache.getAudioBuffer(audioContextMock, url);
    AudioCache.setCacheExpirationTime(next);
    vi.setSystemTime(Date.now() + 3000);
    if (clearMemory) cache = new AudioCache();
    if (initial < 3000) respond();
    await cache.getAudioBuffer(audioContextMock, url);
    const oldFetches = initial < 3000 ? 2 : 1;
    expect(fetchMock).toHaveBeenCalledTimes(oldFetches);

    respond();
    const newUrl = `${url}?new`;
    await cache.getAudioBuffer(audioContextMock, newUrl);
    vi.setSystemTime(Date.now() + 3000);
    if (clearMemory) cache = new AudioCache();
    if (next < 3000) respond();
    await cache.getAudioBuffer(audioContextMock, newUrl);
    expect(fetchMock).toHaveBeenCalledTimes(oldFetches + (next < 3000 ? 2 : 1));
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects invalid TTL %s without changing the configured lifetime", async (invalid) => {
    AudioCache.setCacheExpirationTime(2000);
    expect(() => AudioCache.setCacheExpirationTime(invalid)).toThrow(RangeError);
    respond();
    const first = await cache.getAudioBuffer(audioContextMock, url);
    vi.setSystemTime(Date.now() + 1000);
    expect(await cache.getAudioBuffer(audioContextMock, url)).toBe(first);
    vi.setSystemTime(Date.now() + 2000);
    respond();
    expect(await cache.getAudioBuffer(audioContextMock, url)).not.toBe(first);
  });

  it.each(["etag", "last-modified"])("uses %s validation instead of fallback TTL", async (validator) => {
    const value = validator === "etag" ? '"one"' : "Mon, 01 Sep 2025 00:00:00 GMT";
    respond({ [validator]: value });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { [validator]: value } }));
    await cache.getAudioBuffer(audioContextMock, url);
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const header = validator === "etag" ? "if-none-match" : "if-modified-since";
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get(header)).toBe(value);
  });

  it("respects Expires instead of applying the fallback TTL", async () => {
    respond({ expires: new Date(Date.now() + 1000).toUTCString(), date: new Date().toUTCString() });
    respond();
    await cache.getAudioBuffer(audioContextMock, url);
    vi.setSystemTime(Date.now() + 2000);
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("replaces decoded and persistent representations after a changed 200 response", async () => {
    respond({ "cache-control": "no-cache", etag: '"one"' });
    respond({ "cache-control": "max-age=60", etag: '"two"' });
    const first = await cache.getAudioBuffer(audioContextMock, url);
    const second = await cache.getAudioBuffer(audioContextMock, url);
    expect(second).not.toBe(first);
    expect(await cache.getAudioBuffer(audioContextMock, url)).toBe(second);
    cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(entries.get(url)?.headers.get("etag")).toBe('"two"');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from an unsolicited or mismatched 304 with an unconditional fetch", async () => {
    respond({ "cache-control": "no-cache", etag: '"one"' });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"different"' } }));
    respond({ "cache-control": "max-age=60", etag: '"two"' });
    await cache.getAudioBuffer(audioContextMock, url);
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).has("if-none-match")).toBe(false);
  });

  it.each([false, true])("reloads when a 304 omits the stored ETag (clear memory: %s)", async (clearMemory) => {
    respond({ "cache-control": "no-cache", etag: '"one"' });
    const first = await cache.getAudioBuffer(audioContextMock, url);
    if (clearMemory) cache.clearMemoryCache();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    const replacement = new Uint8Array([5, 6, 7, 8]);
    fetchMock.mockResolvedValueOnce(
      new Response(replacement, { headers: { "cache-control": "max-age=60", etag: '"two"' } }),
    );
    const second = await cache.getAudioBuffer(audioContextMock, url);
    expect(second).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const conditional = fetchMock.mock.calls[1]?.[1];
    const recovery = fetchMock.mock.calls[2]?.[1];
    expect(new Headers(conditional?.headers).get("if-none-match")).toBe('"one"');
    expect(recovery?.cache).toBe("reload");
    expect(recovery?.signal).toBe(conditional?.signal);
    expect(new Headers(recovery?.headers).has("if-none-match")).toBe(false);
    expect(audioContextMock.decodeAudioData).toHaveBeenLastCalledWith(replacement.buffer);
    expect(entries.get(url)?.headers.get("etag")).toBe('"two"');
    cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries 304 when no complete representation exists, preserving the shared signal", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    respond({ "cache-control": "max-age=60" });
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBe(fetchMock.mock.calls[0]?.[1]?.signal);
  });

  it("preserves a complete 203 representation through storage and revalidation", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValueOnce(
      new Response(bytes, { status: 203, headers: { "cache-control": "max-age=60", etag: '"one"' } }),
    );
    const first = await cache.getAudioBuffer(audioContextMock, url);
    expect(audioContextMock.decodeAudioData).toHaveBeenLastCalledWith(bytes.buffer);
    expect(await cache.getAudioBuffer(audioContextMock, url)).toBe(first);
    expect(entries.get(url)?.status).toBe(203);
    cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 61000);
    cache.clearMemoryCache();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"one"' } }));
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("if-none-match")).toBe('"one"');
    expect(entries.get(url)?.status).toBe(203);
    cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("decodes complete 202 responses without treating their status as cacheable 200", async () => {
    for (let i = 0; i < 2; i++) {
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { status: 202 }));
      await expect(cache.getAudioBuffer(audioContextMock, url)).resolves.toBeInstanceOf(AudioBuffer);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(entries.size).toBe(0);
  });

  it.each([204, 205, 206])("rejects status %s without decoding an incomplete representation", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await expect(cache.getAudioBuffer(audioContextMock, url)).rejects.toThrow(String(status));
    expect(audioContextMock.decodeAudioData).not.toHaveBeenCalled();
    expect(entries.size).toBe(0);
  });

  it("fails a recovery fetch cleanly instead of decoding an error response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(cache.getAudioBuffer(audioContextMock, url)).rejects.toThrow("500");
    expect(audioContextMock.decodeAudioData).not.toHaveBeenCalled();
    expect(entries.size).toBe(0);
  });

  it("validates an observable Vary dimension after deserialization", async () => {
    respond({ "cache-control": "max-age=60", vary: "Accept" });
    respond({ "cache-control": "max-age=60", vary: "Accept" });
    await cache.getAudioBuffer(audioContextMock, url);
    const stored = entries.get(url);
    if (!stored) throw new Error("Missing stored representation");
    const metadata: unknown = JSON.parse(stored.headers.get("x-cacophony-cache-policy") ?? "null");
    if (typeof metadata !== "object" || metadata === null || !("requestHeaders" in metadata))
      throw new Error("Missing metadata");
    metadata.requestHeaders = { accept: "audio/wav" };
    stored.headers.set("x-cacophony-cache-policy", JSON.stringify(metadata));
    cache.clearMemoryCache();
    await cache.getAudioBuffer(audioContextMock, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not attach an older decoded buffer to bytes replaced by another cache instance", async () => {
    respond({ "cache-control": "max-age=0", etag: '"one"' });
    respond({ "cache-control": "max-age=60", etag: '"two"' });
    const first = await cache.getAudioBuffer(audioContextMock, url);
    await new AudioCache().getAudioBuffer(audioContextMock, url);
    expect(await cache.getAudioBuffer(audioContextMock, url)).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
