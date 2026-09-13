import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCache } from "./cache";

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Uninitialized deferred");
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("AudioCache storage and lifecycle", () => {
  const url = "https://example.test/audio.wav";
  let cache: AudioCache;
  let context: AudioContext;
  let entries: Map<string, Response>;
  const fetchMock = vi.fn<typeof fetch>();
  const key = (request: Request | string) => (typeof request === "string" ? request : request.url);
  const put = vi.fn<(request: Request | string, response: Response) => Promise<void>>();
  const open = vi.fn();

  function response(headers: Record<string, string> = {}) {
    return new Response(new Uint8Array([1, 2, 3, 4]), { headers });
  }

  beforeEach(() => {
    cache = new AudioCache();
    context = new AudioContext();
    entries = new Map();
    fetchMock.mockReset().mockImplementation(async () => response());
    put.mockReset().mockImplementation(async (request, value) => {
      entries.set(key(request), value.clone());
    });
    open.mockReset().mockResolvedValue({
      match: async (request: Request | string) => entries.get(key(request))?.clone(),
      put,
      delete: async (request: Request | string) => entries.delete(key(request)),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", { open });
    vi.spyOn(context, "decodeAudioData").mockImplementation(
      async () => new AudioBuffer({ length: 4, sampleRate: 48000 }),
    );
    AudioCache.setCacheExpirationTime(86400000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    AudioCache.setCacheExpirationTime(86400000);
  });

  it.each([true, false])("reuses a decoded buffer (persistent cache: %s)", async (persistent) => {
    if (!persistent) vi.stubGlobal("caches", undefined);
    const first = await cache.getAudioBuffer(context, url);
    const hit = vi.fn();
    expect(await cache.getAudioBuffer(context, url, undefined, { onCacheHit: hit })).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenCalledWith(expect.objectContaining({ cacheType: "memory" }));
  });

  it("reuses persistent bytes after clearing decoded memory", async () => {
    const first = await cache.getAudioBuffer(context, url);
    cache.clearMemoryCache();
    const onCacheHit = vi.fn();
    expect(await cache.getAudioBuffer(context, url, undefined, { onCacheHit })).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(onCacheHit).toHaveBeenCalledWith(expect.objectContaining({ cacheType: "browser" }));
  });

  it("uses a new namespace and ignores legacy metadata", async () => {
    entries.set(url, response());
    entries.set(`${url}:meta`, new Response(JSON.stringify({ timestamp: Date.now(), cacheControl: "max-age=3600" })));
    await cache.getAudioBuffer(context, url);
    expect(open).toHaveBeenCalledWith("audio-cache-v2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "invalid",
    '{"version":999}',
    '{"version":2,"time":"yesterday"}',
  ])("discards malformed stored policy: %s", async (metadata) => {
    entries.set(url, response({ "x-cacophony-cache-policy": metadata }));
    await cache.getAudioBuffer(context, url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stores bytes and policy in a single write", async () => {
    await cache.getAudioBuffer(context, url);
    expect(put).toHaveBeenCalledTimes(1);
    expect(entries.size).toBe(1);
    const stored = entries.get(url);
    expect(stored?.headers.has("x-cacophony-cache-policy")).toBe(true);
    expect(new Uint8Array((await stored?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("reports storage failure without leaving an old persistent response", async () => {
    await cache.getAudioBuffer(context, url);
    cache.clearMemoryCache();
    // An invalid entry must not survive a failed replacement write.
    entries.set(url, response());
    put.mockRejectedValueOnce(new Error("quota"));
    const onCacheError = vi.fn();
    await cache.getAudioBuffer(context, url, undefined, { onCacheError });
    expect(entries.has(url)).toBe(false);
    expect(onCacheError).toHaveBeenCalledWith(expect.objectContaining({ operation: "set" }));
  });

  it("continues with policy-aware memory when persistent storage is unavailable", async () => {
    open.mockRejectedValue(new Error("denied"));
    const onCacheError = vi.fn();
    const first = await cache.getAudioBuffer(context, url, undefined, { onCacheError });
    expect(await cache.getAudioBuffer(context, url)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onCacheError).toHaveBeenCalledWith(expect.objectContaining({ operation: "get" }));
  });

  it("decodes independently in different contexts while sharing persistent bytes", async () => {
    const other = new AudioContext();
    const secondBuffer = new AudioBuffer({ length: 5, sampleRate: 44100 });
    vi.spyOn(other, "decodeAudioData").mockResolvedValue(secondBuffer);
    const first = await cache.getAudioBuffer(context, url);
    expect(await cache.getAudioBuffer(other, url)).toBe(secondBuffer);
    expect(secondBuffer).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts decoded buffers by bytes in LRU order", async () => {
    vi.stubGlobal("caches", undefined);
    // The mock allocates channel arrays lazily, so large lengths need no audio allocation.
    vi.mocked(context.decodeAudioData).mockImplementation(
      async () => new AudioBuffer({ length: 8 * 1024 * 1024, numberOfChannels: 1, sampleRate: 48000 }),
    );
    await cache.getAudioBuffer(context, `${url}?a`);
    await cache.getAudioBuffer(context, `${url}?b`);
    await cache.getAudioBuffer(context, `${url}?a`);
    await cache.getAudioBuffer(context, `${url}?c`);
    await cache.getAudioBuffer(context, `${url}?b`);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retain a decoded buffer larger than the byte budget", async () => {
    vi.stubGlobal("caches", undefined);
    vi.mocked(context.decodeAudioData).mockImplementation(
      async () => new AudioBuffer({ length: 17 * 1024 * 1024, numberOfChannels: 1, sampleRate: 48000 }),
    );
    await cache.getAudioBuffer(context, url);
    await cache.getAudioBuffer(context, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "data:audio/wav;base64,AQIDBA==",
    "data:audio/wav,%01%02%03%04",
  ])("decodes and caches %s without network or persistent storage", async (dataUrl) => {
    const first = await cache.getAudioBuffer(context, dataUrl);
    expect(await cache.getAudioBuffer(context, dataUrl)).toBe(first);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    const bytes = vi.mocked(context.decodeAudioData).mock.calls[0]?.[0];
    expect(bytes && new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("reports malformed data URLs", async () => {
    const onLoadingError = vi.fn();
    await expect(cache.getAudioBuffer(context, "data:broken", undefined, { onLoadingError })).rejects.toThrow();
    expect(onLoadingError).toHaveBeenCalledWith(expect.objectContaining({ errorType: "decode" }));
  });

  it("shares fetch and decode across concurrent callers and reports completion to each", async () => {
    const done1 = vi.fn();
    const done2 = vi.fn();
    const results = await Promise.all([
      cache.getAudioBuffer(context, url, undefined, { onLoadingComplete: done1 }),
      cache.getAudioBuffer(context, url, undefined, { onLoadingComplete: done2 }),
    ]);
    expect(results[0]).toBe(results[1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(done1).toHaveBeenCalledTimes(1);
    expect(done2).toHaveBeenCalledWith(expect.objectContaining({ size: 4 }));
  });

  it("one caller's abort preserves the request for existing and later subscribers", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const abortedComplete = vi.fn();
    const first = cache
      .getAudioBuffer(context, url, controller.signal, { onLoadingComplete: abortedComplete })
      .catch((error: unknown) => error);
    const second = cache.getAudioBuffer(context, url);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    const third = cache.getAudioBuffer(context, url);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    pending.resolve(response());
    expect(await first).toMatchObject({ name: "AbortError" });
    expect(await second).toBe(await third);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(abortedComplete).not.toHaveBeenCalled();
  });

  it("last-subscriber abort permits a replacement and ignores late old results", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const a = new AbortController();
    const b = new AbortController();
    const first = cache.getAudioBuffer(context, url, a.signal).catch((error: unknown) => error);
    const second = cache.getAudioBuffer(context, url, b.signal).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sharedSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    a.abort();
    expect(sharedSignal?.aborted).toBe(false);
    b.abort();
    expect(sharedSignal?.aborted).toBe(true);
    const replacement = await cache.getAudioBuffer(context, url);
    pending.resolve(response());
    expect(await first).toMatchObject({ name: "AbortError" });
    expect(await second).toMatchObject({ name: "AbortError" });
    expect(await cache.getAudioBuffer(context, url)).toBe(replacement);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
  });

  it("rejects a pre-aborted caller even if memory is fresh", async () => {
    await cache.getAudioBuffer(context, url);
    await expect(cache.getAudioBuffer(context, url, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clearing memory isolates a new pending run from an older run", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const first = cache.getAudioBuffer(context, url);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    cache.clearMemoryCache();
    const second = await cache.getAudioBuffer(context, url);
    pending.resolve(response());
    expect(await first).not.toBe(second);
    expect(await cache.getAudioBuffer(context, url)).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checks cancellation after decoding before retaining a result", async () => {
    const pending = deferred<AudioBuffer>();
    vi.mocked(context.decodeAudioData).mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const result = cache.getAudioBuffer(context, url, controller.signal).catch((error: unknown) => error);
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(1));
    controller.abort();
    pending.resolve(new AudioBuffer({ length: 4, sampleRate: 48000 }));
    expect(await result).toMatchObject({ name: "AbortError" });
    await cache.getAudioBuffer(context, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not persist bytes that fail decoding", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(context.decodeAudioData).mockRejectedValueOnce(new Error("invalid audio"));
    await expect(cache.getAudioBuffer(context, url)).rejects.toThrow("invalid audio");
    expect(entries.size).toBe(0);
    await cache.getAudioBuffer(context, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("evicts persisted bytes that the current decoder rejects", async () => {
    await cache.getAudioBuffer(context, url);
    cache.clearMemoryCache();
    vi.mocked(context.decodeAudioData).mockRejectedValueOnce(new Error("invalid audio"));
    await expect(cache.getAudioBuffer(context, url)).rejects.toThrow("invalid audio");
    expect(entries.size).toBe(0);
    await cache.getAudioBuffer(context, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "decode"])("reports a %s failure once and allows retry", async (kind) => {
    vi.stubGlobal("caches", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    if (kind === "network") fetchMock.mockRejectedValueOnce(new Error("network"));
    else vi.mocked(context.decodeAudioData).mockRejectedValueOnce(new Error("decode"));
    const onLoadingError = vi.fn();
    await expect(cache.getAudioBuffer(context, url, undefined, { onLoadingError })).rejects.toThrow(kind);
    expect(onLoadingError).toHaveBeenCalledTimes(1);
    expect(onLoadingError).toHaveBeenCalledWith(expect.objectContaining({ errorType: kind }));
    await cache.getAudioBuffer(context, url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("collects streamed bytes exactly (known length: %s)", async (knownLength) => {
    const chunks = [new Uint8Array(5000).fill(1), new Uint8Array(5000).fill(2)];
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
        { headers: knownLength ? { "content-length": "10000" } : {} },
      ),
    );
    await cache.getAudioBuffer(context, url);
    const bytes = vi.mocked(context.decodeAudioData).mock.calls[0]?.[0];
    expect(bytes?.byteLength).toBe(10000);
    expect(bytes && new Uint8Array(bytes)[5000]).toBe(2);
  });
});
