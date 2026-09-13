import CachePolicy from "http-cache-semantics";
import type { BaseContext } from "./context";
import type { AudioEventCallbacks } from "./events";

export type CacheCallbacks = Pick<
  AudioEventCallbacks,
  | "onLoadingStart"
  | "onLoadingProgress"
  | "onLoadingComplete"
  | "onLoadingError"
  | "onCacheHit"
  | "onCacheMiss"
  | "onCacheError"
>;

export interface ICache {
  getAudioBuffer(
    context: BaseContext,
    url: string,
    signal?: AbortSignal,
    callbacks?: CacheCallbacks,
  ): Promise<AudioBuffer>;
  clearMemoryCache(): void;
}

const CACHE_NAME = "audio-cache-v2";
const POLICY_HEADER = "x-cacophony-cache-policy";
const MEMORY_BYTES = 64 * 1024 * 1024;
const REQUEST_HEADERS = { accept: "*/*" };

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Operation was aborted", "AbortError");
}

class ByteBoundedLRUCache<K, V> {
  private cachedBytes = 0;
  private readonly cache = new Map<K, { value: V; bytes: number }>();
  constructor(
    private readonly maxBytes: number,
    private readonly estimateBytes: (value: V) => number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  delete(key: K): void {
    this.cachedBytes -= this.cache.get(key)?.bytes ?? 0;
    this.cache.delete(key);
  }

  set(key: K, value: V): void {
    this.delete(key);
    const bytes = this.estimateBytes(value);
    if (bytes > this.maxBytes) return;
    while (this.cachedBytes + bytes > this.maxBytes) {
      const first = this.cache.keys().next();
      if (first.done) break;
      this.delete(first.value);
    }
    this.cache.set(key, { value, bytes });
    this.cachedBytes += bytes;
  }
}

interface HttpEntry {
  policy: CachePolicy;
  cors: boolean;
  /** Origin headers before the explicitly configured fallback TTL is applied. */
  headers: Record<string, string>;
  /** Identical envelope attached to stored bytes and their decoded buffer. */
  metadata: string;
}

interface MemoryEntry {
  buffer: AudioBuffer;
  http?: HttpEntry;
}
interface Subscriber {
  callbacks?: CacheCallbacks;
}
interface PendingRequest {
  controller: AbortController;
  subscribers: Set<Subscriber>;
  promise: Promise<AudioBuffer>;
}
type Notify = (deliver: (callbacks: CacheCallbacks) => void) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeaders(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function policyHeaders(headers: CachePolicy.Headers): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) result.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return result;
}

/**
 * HTTP policy governs decoded memory entries and persistent response bytes.
 * Bytes and versioned policy share ONE Cache API response, preventing split
 * writes. Legacy v1 entries are not read. Memory is bounded per decoding context.
 */
export class AudioCache implements ICache {
  private static cacheExpirationTime = 24 * 60 * 60 * 1000;
  private decodedBuffers = new WeakMap<BaseContext, ByteBoundedLRUCache<string, MemoryEntry>>();
  private pendingRequests = new WeakMap<BaseContext, Map<string, PendingRequest>>();

  /** Fallback for responses with no cache directives, expiry, or validators. */
  static setCacheExpirationTime(time: number): void {
    if (!Number.isFinite(time) || time < 0) throw new RangeError("Cache expiration must be finite and non-negative");
    AudioCache.cacheExpirationTime = time;
  }

  private static createEntry(request: Request, headers: Record<string, string>, cors = false): HttpEntry {
    const effectiveHeaders = { ...headers };
    // Application default only: explicit directives, Expires and validators win.
    // All parsing and reuse decisions still belong to upstream CachePolicy.
    if (!["cache-control", "expires", "pragma", "etag", "last-modified"].some((key) => key in headers)) {
      effectiveHeaders["cache-control"] = `max-age=${Math.floor(AudioCache.cacheExpirationTime / 1000)}`;
    }
    const requestHeaders = Object.fromEntries(request.headers);
    const policy = new CachePolicy(
      { url: request.url, method: "GET", headers: requestHeaders },
      { status: 200, headers: effectiveHeaders },
      { shared: false, cacheHeuristic: 0, immutableMinTimeToLive: 0 },
    );
    const metadata = JSON.stringify({
      version: 2,
      cors,
      url: request.url,
      time: policy.toObject().t,
      requestHeaders,
      policyHeaders: effectiveHeaders,
      headers,
    });
    return { policy, headers, metadata, cors };
  }

  private static readEntry(response: Response, request: Request): HttpEntry | undefined {
    const metadata = response.headers.get(POLICY_HEADER);
    if (!metadata) return undefined;
    try {
      const value: unknown = JSON.parse(metadata);
      if (
        !isRecord(value) ||
        value.version !== 2 ||
        value.url !== request.url ||
        typeof value.time !== "number" ||
        !Number.isFinite(value.time) ||
        value.time > Date.now() ||
        !isHeaders(value.requestHeaders) ||
        !isHeaders(value.policyHeaders) ||
        !isHeaders(value.headers)
      )
        return undefined;
      // Reparse directives upstream, rather than trusting internal parsed fields
      // from persistent JSON. Restore time with the public serialization API.
      const serialized = new CachePolicy(
        { url: request.url, method: "GET", headers: value.requestHeaders },
        { status: 200, headers: value.policyHeaders },
        { shared: false, cacheHeuristic: 0, immutableMinTimeToLive: 0 },
      ).toObject();
      serialized.t = value.time;
      return {
        policy: CachePolicy.fromObject(serialized),
        headers: value.headers,
        metadata,
        cors: value.cors === true,
      };
    } catch {
      return undefined;
    }
  }

  private static canRetain(entry: HttpEntry): boolean {
    // Only Accept is explicitly controlled by this URL-only API. Cookie,
    // Accept-Language, etc. may be added or changed invisibly by the host.
    const vary =
      entry.headers.vary
        ?.split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean) ?? [];
    return entry.policy.storable() && vary.every((name) => name === "accept");
  }

  private getMemory(context: BaseContext): ByteBoundedLRUCache<string, MemoryEntry> {
    let memory = this.decodedBuffers.get(context);
    if (!memory) {
      memory = new ByteBoundedLRUCache(MEMORY_BYTES, ({ buffer }) => buffer.length * buffer.numberOfChannels * 4);
      this.decodedBuffers.set(context, memory);
    }
    return memory;
  }

  private join(
    context: BaseContext,
    url: string,
    signal: AbortSignal | undefined,
    callbacks: CacheCallbacks | undefined,
    load: (signal: AbortSignal, notify: Notify) => Promise<AudioBuffer>,
  ): Promise<AudioBuffer> {
    checkAbort(signal);
    let requests = this.pendingRequests.get(context);
    if (!requests) {
      requests = new Map();
      this.pendingRequests.set(context, requests);
    }
    const subscriber = { callbacks };
    let pending = requests.get(url);
    if (!pending) {
      const controller = new AbortController();
      const subscribers = new Set<Subscriber>();
      const notify: Notify = (deliver) => {
        for (const current of subscribers) if (current.callbacks) deliver(current.callbacks);
      };
      const promise = Promise.resolve().then(() => load(controller.signal, notify));
      pending = { controller, subscribers, promise };
      requests.set(url, pending);
    }
    const active = pending;
    const requestMap = requests;
    active.subscribers.add(subscriber);
    return new Promise((resolve, reject) => {
      let settled = false;
      const release = () => {
        settled = true;
        signal?.removeEventListener("abort", abort);
        active.subscribers.delete(subscriber);
        if (active.subscribers.size === 0 && requestMap.get(url) === active) requestMap.delete(url);
      };
      const abort = () => {
        if (settled) return;
        release();
        if (active.subscribers.size === 0) active.controller.abort();
        reject(new DOMException("Operation was aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      active.promise.then(
        (buffer) => {
          if (!settled) {
            release();
            resolve(buffer);
          }
        },
        (error: unknown) => {
          if (!settled) {
            release();
            reject(error);
          }
        },
      );
    });
  }

  private static cacheError(notify: Notify, url: string, error: unknown, operation: "get" | "set" | "delete"): void {
    notify((callbacks) => callbacks.onCacheError?.({ url, error: toError(error), operation, timestamp: Date.now() }));
  }

  private static async openCache(notify: Notify, url: string): Promise<Cache | undefined> {
    if (typeof caches === "undefined" || caches === null) return undefined;
    try {
      return await caches.open(CACHE_NAME);
    } catch (error) {
      AudioCache.cacheError(notify, url, error, "get");
      return undefined;
    }
  }

  private static async deleteResponse(
    cache: Cache | undefined,
    request: Request,
    notify: Notify,
    url: string,
  ): Promise<void> {
    if (!cache) return;
    try {
      await cache.delete(request, { ignoreVary: true });
    } catch (error) {
      AudioCache.cacheError(notify, url, error, "delete");
    }
  }

  private static async storeResponse(
    cache: Cache | undefined,
    request: Request,
    bytes: ArrayBuffer,
    entry: HttpEntry,
    notify: Notify,
    url: string,
  ): Promise<void> {
    if (!cache) return;
    const headers = new Headers(entry.headers);
    // Fetch already decoded content coding; stored bytes are uncompressed.
    headers.delete("content-encoding");
    headers.set("content-length", String(bytes.byteLength));
    headers.set(POLICY_HEADER, entry.metadata);
    try {
      await cache.put(request, new Response(bytes, { status: 200, headers }));
    } catch (error) {
      await AudioCache.deleteResponse(cache, request, notify, url);
      AudioCache.cacheError(notify, url, error, "set");
    }
  }

  private static async readBytes(
    response: Response,
    signal: AbortSignal,
    notify: Notify,
    url: string,
  ): Promise<ArrayBuffer> {
    if (!response.body) return response.arrayBuffer();
    const contentLength = Number(response.headers.get("content-length"));
    const total =
      Number.isFinite(contentLength) && contentLength > 0 && !response.headers.has("content-encoding")
        ? contentLength
        : null;
    const reader = response.body.getReader();
    let bytes = new Uint8Array(total ?? 8192);
    let loaded = 0;
    const abort = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", abort, { once: true });
    const progress = (done: boolean) => {
      const timestamp = Date.now();
      notify((callbacks) =>
        callbacks.onLoadingProgress?.({
          url,
          loaded,
          total,
          progress: total ? (done ? 1 : loaded / total) : -1,
          timestamp,
        }),
      );
    };
    try {
      while (true) {
        checkAbort(signal);
        const next = await reader.read();
        checkAbort(signal);
        if (next.done) break;
        if (loaded + next.value.byteLength > bytes.length) {
          const grown = new Uint8Array(Math.max(bytes.length * 2, loaded + next.value.byteLength));
          grown.set(bytes.subarray(0, loaded));
          bytes = grown;
        }
        bytes.set(next.value, loaded);
        loaded += next.value.byteLength;
        progress(false);
      }
      progress(true);
      return bytes.slice(0, loaded).buffer;
    } finally {
      signal.removeEventListener("abort", abort);
      reader.releaseLock();
    }
  }

  private async loadHttp(
    context: BaseContext,
    url: string,
    memory: ByteBoundedLRUCache<string, MemoryEntry>,
    signal: AbortSignal,
    notify: Notify,
  ): Promise<AudioBuffer> {
    let errorType: "network" | "decode" = "network";
    try {
      checkAbort(signal);
      const request = new Request(url, { headers: REQUEST_HEADERS });
      const policyRequest = { url: request.url, method: "GET", headers: Object.fromEntries(request.headers) };
      let cached = memory.get(url);
      if (
        cached?.http &&
        AudioCache.canRetain(cached.http) &&
        cached.http.policy.satisfiesWithoutRevalidation(policyRequest)
      ) {
        notify((callbacks) => callbacks.onCacheHit?.({ url, cacheType: "memory", timestamp: Date.now() }));
        return cached.buffer;
      }
      const persistent = await AudioCache.openCache(notify, url);
      let stored: Response | undefined;
      let entry = cached?.http;
      if (persistent) {
        try {
          stored = await persistent.match(request);
          if (stored) {
            const storedEntry = AudioCache.readEntry(stored, request);
            if (!storedEntry || !AudioCache.canRetain(storedEntry)) {
              stored = undefined;
              await AudioCache.deleteResponse(persistent, request, notify, url);
            } else if (entry?.metadata !== storedEntry.metadata) {
              // Never combine a different persisted representation with an older
              // decoded buffer (another context/cache instance may have written).
              entry = storedEntry;
              cached = undefined;
            }
          }
        } catch (error) {
          AudioCache.cacheError(notify, url, error, "get");
        }
      }
      checkAbort(signal);
      if (entry && stored && entry.policy.satisfiesWithoutRevalidation(policyRequest)) {
        const bytes = await stored.arrayBuffer();
        errorType = "decode";
        let buffer: AudioBuffer;
        try {
          buffer = await context.decodeAudioData(bytes);
        } catch (error) {
          await AudioCache.deleteResponse(persistent, request, notify, url);
          throw error;
        }
        checkAbort(signal);
        memory.set(url, { buffer, http: entry });
        notify((callbacks) => callbacks.onCacheHit?.({ url, cacheType: "browser", timestamp: Date.now() }));
        return buffer;
      }
      notify((callbacks) =>
        callbacks.onCacheMiss?.({ url, reason: entry ? "expired" : "not-found", timestamp: Date.now() }),
      );
      const cors = entry?.cors || (typeof location !== "undefined" && new URL(request.url).origin !== location.origin);
      // Browser-generated conditional headers do not require CORS preflight.
      // Let Fetch validate cross-origin entries, including hidden validators.
      const headers = entry && !cors ? policyHeaders(entry.policy.revalidationHeaders(policyRequest)) : request.headers;
      let response = await fetch(url, { headers, signal, cache: entry ? "no-cache" : "default" });
      checkAbort(signal);
      let bytes: ArrayBuffer | undefined;
      let buffer: AudioBuffer | undefined;
      let conditional = false;
      if (response.status === 304 && entry && (stored || cached)) {
        const update = entry.policy.revalidatedPolicy(policyRequest, {
          status: 304,
          headers: Object.fromEntries(response.headers),
        });
        if (update.matches && !update.modified) {
          const merged = { ...entry.headers };
          // Include NEW origin header names: upstream 4.1.1's merge only carries
          // names that were already in the old response. No directive parsing.
          response.headers.forEach((value, key) => {
            if (!["content-length", "content-encoding", POLICY_HEADER].includes(key)) merged[key] = value;
          });
          merged.date = response.headers.get("date") ?? new Date().toUTCString();
          merged.age = response.headers.get("age") ?? "0";
          entry = AudioCache.createEntry(request, merged, entry.cors);
          buffer = cached?.buffer;
          bytes = stored ? await stored.arrayBuffer() : undefined;
          conditional = true;
        }
      }
      if (response.status === 304 && !conditional) {
        response = await fetch(url, { headers: request.headers, signal, cache: "reload" });
        checkAbort(signal);
      }
      if (!conditional) {
        if (response.status !== 200)
          throw new Error(`Failed to fetch resource: ${response.status} ${response.statusText}`);
        const originHeaders = Object.fromEntries(response.headers);
        delete originHeaders[POLICY_HEADER];
        entry = AudioCache.createEntry(request, originHeaders, response.type === "cors");
        bytes = await AudioCache.readBytes(response, signal, notify, url);
      }
      checkAbort(signal);
      if (!entry) throw new Error("Missing response policy");
      const retain = AudioCache.canRetain(entry);
      memory.delete(url);
      if (!retain) await AudioCache.deleteResponse(persistent, request, notify, url);
      if (!buffer) {
        if (!bytes) throw new Error("Missing response body");
        const byteLength = bytes.byteLength;
        // Native decoding can detach its input buffer.
        const persistentBytes = retain && persistent ? bytes.slice(0) : undefined;
        errorType = "decode";
        try {
          buffer = await context.decodeAudioData(bytes);
        } catch (error) {
          console.error("Failed to decode audio data:", error);
          throw error;
        }
        checkAbort(signal);
        if (persistentBytes) await AudioCache.storeResponse(persistent, request, persistentBytes, entry, notify, url);
        const decoded = buffer;
        notify((callbacks) =>
          callbacks.onLoadingComplete?.({ url, duration: decoded.duration, size: byteLength, timestamp: Date.now() }),
        );
      } else if (retain && bytes) {
        await AudioCache.storeResponse(persistent, request, bytes, entry, notify, url);
      }
      checkAbort(signal);
      if (retain) memory.set(url, { buffer, http: entry });
      if (conditional)
        notify((callbacks) => callbacks.onCacheHit?.({ url, cacheType: "conditional", timestamp: Date.now() }));
      return buffer;
    } catch (error) {
      notify((callbacks) =>
        callbacks.onLoadingError?.({ url, error: toError(error), errorType, timestamp: Date.now() }),
      );
      throw error;
    }
  }

  async getAudioBuffer(
    context: BaseContext,
    url: string,
    signal?: AbortSignal,
    callbacks?: CacheCallbacks,
  ): Promise<AudioBuffer> {
    checkAbort(signal);
    callbacks?.onLoadingStart?.({ url, timestamp: Date.now() });
    const memory = this.getMemory(context);
    if (url.startsWith("data:")) {
      const hit = memory.get(url);
      if (hit) {
        callbacks?.onCacheHit?.({ url, cacheType: "memory", timestamp: Date.now() });
        return hit.buffer;
      }
      try {
        const comma = url.indexOf(",");
        if (comma < 0) throw new Error("Malformed data URL");
        const header = url.slice(5, comma);
        const payload = url.slice(comma + 1);
        const decoded = /;base64$/i.test(header) ? atob(payload) : decodeURIComponent(payload);
        const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer);
        checkAbort(signal);
        memory.set(url, { buffer });
        return buffer;
      } catch (error) {
        callbacks?.onLoadingError?.({ url, error: toError(error), errorType: "decode", timestamp: Date.now() });
        throw error;
      }
    }
    return this.join(context, url, signal, callbacks, (runSignal, notify) =>
      this.loadHttp(context, url, memory, runSignal, notify),
    );
  }

  clearMemoryCache(): void {
    this.decodedBuffers = new WeakMap();
    this.pendingRequests = new WeakMap();
  }
}
