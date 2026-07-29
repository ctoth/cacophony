import type { BaseContext } from "./context";
import type { AudioEventCallbacks, CacheHitEvent, LoadingProgressEvent } from "./events";

/**
 * Subset of {@link AudioEventCallbacks} relevant to {@link AudioCache} public API.
 * Lets callers opt in to any combination of loading/cache events without
 * having to import the full union.
 */
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

/**
 * Coerce an unknown caught value into an `Error`. Use at the boundary
 * of `catch (error: unknown)` blocks where downstream typing requires a real
 * `Error` (e.g. `LoadingErrorEvent.error`, `CacheErrorEvent.error`).
 */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Build the metadata cache key for a given URL. Centralised so the
 * ":meta" suffix never drifts across writers/readers/cleanup paths.
 */
function metaKey(url: string): string {
  return `${url}:meta`;
}

class ByteBoundedLRUCache<K, V> {
  private maxBytes: number;
  private cachedBytes = 0;
  private cache: Map<K, { value: V; bytes: number }>;
  private estimateBytes: (value: V) => number;

  constructor(maxBytes: number, estimateBytes: (value: V) => number) {
    this.maxBytes = maxBytes;
    this.estimateBytes = estimateBytes;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const bytes = this.estimateBytes(value);

    if (this.cache.has(key)) {
      this.cachedBytes -= this.cache.get(key)?.bytes ?? 0;
      this.cache.delete(key);
    }

    if (bytes > this.maxBytes) {
      return;
    }

    while (this.cachedBytes + bytes > this.maxBytes) {
      const first = this.cache.keys().next();
      if (first.done) {
        break;
      }
      const firstKey = first.value;
      const oldest = this.cache.get(firstKey);
      this.cachedBytes -= oldest?.bytes ?? 0;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, { value, bytes });
    this.cachedBytes += bytes;
  }
}

interface CacheMetadata {
  url: string;
  etag?: string;
  lastModified?: string;
  cacheControl?: string;
  timestamp: number;
}

/**
 * Validator tokens carried in cache metadata, used to build conditional
 * requests (`If-None-Match`, `If-Modified-Since`).
 */
type CacheValidators = Pick<CacheMetadata, "etag" | "lastModified">;

const DEFAULT_DECODED_BUFFER_CACHE_BYTES = 64 * 1024 * 1024;
const BYTES_PER_FLOAT32_SAMPLE = 4;

function estimateAudioBufferBytes(audioBuffer: AudioBuffer): number {
  return audioBuffer.length * audioBuffer.numberOfChannels * BYTES_PER_FLOAT32_SAMPLE;
}

/**
 * Parse the max-age value from a Cache-Control header.
 *
 * Accepts unquoted (`max-age=3600`) and properly-quoted (`max-age="3600"`)
 * forms only; rejects malformed half-quoted variants like `max-age="3600`
 * or `max-age=3600"`.
 *
 * @returns max-age in seconds, or null if not found / malformed
 */
function parseMaxAge(cacheControlHeader: string | undefined): number | null {
  if (!cacheControlHeader) {
    return null;
  }
  // Either both quotes or neither; (?:...) groups the alternatives.
  const match = cacheControlHeader.match(/max-age\s*=\s*(?:"(\d+)"|(\d+))/i);
  if (!match) return null;
  const captured = match[1] ?? match[2];
  if (captured === undefined) return null;
  const parsed = Number.parseInt(captured, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Check if Cache-Control header contains directives that require revalidation
 * @param cacheControlHeader - The Cache-Control header value
 * @returns true if revalidation is required regardless of age
 */
function requiresRevalidation(cacheControlHeader: string | undefined): boolean {
  if (!cacheControlHeader) {
    return false;
  }
  return /(?:^|,)\s*(no-cache|no-store|must-revalidate)\s*(?:,|$)/i.test(cacheControlHeader);
}

function getNetworkErrorType(error: unknown): "network" | "abort" | "unknown" {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "abort";
  }
  if (error instanceof Error) {
    return "network";
  }
  return "unknown";
}

/**
 * Parse a `data:` URL into its mime type and decoded bytes.
 * Returns `null` if the URL is malformed (no comma, undecodable base64, etc.)
 * so callers can fire a typed `onLoadingError` instead of crashing.
 */
function parseDataUrl(url: string): { mime: string; bytes: Uint8Array } | null {
  const commaIndex = url.indexOf(",");
  if (commaIndex < 0) return null;
  const header = url.slice(5, commaIndex); // strip "data:"
  const payload = url.slice(commaIndex + 1);
  const isBase64 = /;base64$/i.test(header);
  const mime = (isBase64 ? header.replace(/;base64$/i, "") : header) || "text/plain";
  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { mime, bytes };
    }
    const decoded = decodeURIComponent(payload);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return { mime, bytes };
  } catch {
    return null;
  }
}

export interface ICache {
  getAudioBuffer(
    context: BaseContext,
    url: string,
    signal?: AbortSignal,
    callbacks?: CacheCallbacks,
  ): Promise<AudioBuffer>;
  clearMemoryCache(): void;
}

/**
 * AudioCache provides efficient caching of audio resources using HTTP caching standards.
 *
 * Features:
 * - Three-layer caching: Memory (LRU) → Browser Cache API → Network
 * - HTTP conditional requests with ETag and Last-Modified support
 * - Robust error handling with cache inconsistency recovery
 *
 * Caching Strategy:
 * - Always makes conditional requests when validation tokens (ETag/Last-Modified) are available
 * - Uses TTL as fallback only when no validation tokens exist
 * - Conditional requests are lightweight (304 responses have no body)
 *
 * @example
 * ```typescript
 * const cache = new AudioCache();
 * const audioBuffer = await cache.getAudioBuffer(audioContext, 'audio.mp3');
 *
 * // Optional: Configure TTL for when no validation tokens exist
 * AudioCache.setCacheExpirationTime(60 * 60 * 1000); // 1 hour
 * ```
 */
export class AudioCache implements ICache {
  private pendingRequests = new WeakMap<BaseContext, Map<string, Promise<AudioBuffer>>>();
  private pendingCallbacks = new WeakMap<BaseContext, Map<string, Array<Pick<CacheCallbacks, "onLoadingProgress">>>>();
  private decodedBuffers = new WeakMap<BaseContext, ByteBoundedLRUCache<string, AudioBuffer>>();
  private static cacheExpirationTime: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  public static setCacheExpirationTime(time: number): void {
    AudioCache.cacheExpirationTime = time;
  }

  /**
   * Whether the browser Cache API (`caches`) global is available in the
   * current runtime. Uses `typeof` so it never throws when the global is
   * entirely absent (e.g. Node). When this returns `false`, the URL path
   * degrades to fetch + decode (still using the in-memory LRU) instead of
   * touching the persistent Cache API.
   */
  private static isCacheApiAvailable(): boolean {
    return typeof caches !== "undefined" && caches != null;
  }

  private static async openCache(): Promise<Cache> {
    try {
      return await caches.open("audio-cache");
    } catch (error) {
      console.error("Failed to open cache:", error);
      throw error;
    }
  }

  /**
   * Calls all registered callbacks for a specific event type on a URL.
   * Generic over the callback name so the payload type is checked against
   * the canonical {@link CacheCallbacks} shape rather than `any`.
   */
  private static callAllCallbacks<K extends keyof CacheCallbacks>(
    pendingCallbacks: Map<string, Array<Pick<CacheCallbacks, "onLoadingProgress">>> | undefined,
    url: string,
    callbackName: K,
    eventData: Parameters<NonNullable<CacheCallbacks[K]>>[0],
  ): void {
    const callbacks = pendingCallbacks?.get(url);
    if (callbacks) {
      callbacks.forEach((callbackSet) => {
        const callback = callbackSet[callbackName as "onLoadingProgress"];
        if (callback) {
          try {
            // Cast eventData here: the surrounding generic guarantees the
            // payload type matches the chosen callback name.
            (callback as (e: typeof eventData) => void)(eventData);
          } catch (error) {
            console.error(`Error in ${String(callbackName)} callback:`, error);
          }
        }
      });
    }
  }

  private async getOrCreatePendingRequest(
    context: BaseContext,
    url: string,
    createRequest: () => Promise<AudioBuffer | undefined>,
    signal?: AbortSignal,
    callbacks?: Pick<CacheCallbacks, "onLoadingProgress">,
  ): Promise<AudioBuffer> {
    if (signal?.aborted) {
      throw new DOMException("Operation was aborted", "AbortError");
    }

    let pendingRequests = this.pendingRequests.get(context);
    if (pendingRequests === undefined) {
      pendingRequests = new Map();
      this.pendingRequests.set(context, pendingRequests);
    }
    let pendingCallbacks = this.pendingCallbacks.get(context);
    if (pendingCallbacks === undefined) {
      pendingCallbacks = new Map();
      this.pendingCallbacks.set(context, pendingCallbacks);
    }

    // Add callbacks to aggregation if provided
    if (callbacks) {
      const existingCallbacks = pendingCallbacks.get(url) || [];
      existingCallbacks.push(callbacks);
      pendingCallbacks.set(url, existingCallbacks);
    }

    const pendingRequest = pendingRequests.get(url);
    if (!pendingRequest) {
      const requestPromise = (async () => {
        try {
          const result = await createRequest();
          if (result === undefined) {
            throw new Error("Failed to create audio buffer.");
          }
          return result;
        } finally {
          pendingRequests.delete(url);
          pendingCallbacks.delete(url); // Clean up callbacks too
        }
      })();

      // Clean up on abort
      signal?.addEventListener(
        "abort",
        () => {
          if (signal.aborted) {
            pendingRequests.delete(url);
            pendingCallbacks.delete(url); // Clean up callbacks too
          }
        },
        { once: true },
      );

      pendingRequests.set(url, requestPromise);
      return requestPromise;
    }
    return pendingRequest;
  }

  private static async updateMetadata(cache: Cache, url: string, data: Partial<CacheMetadata>): Promise<void> {
    const metadata: CacheMetadata = {
      url,
      timestamp: Date.now(),
      ...data,
    };

    await cache.put(
      metaKey(url),
      new Response(JSON.stringify(metadata), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  private static async getBufferFromCache(url: string, cache: Cache): Promise<ArrayBuffer | null> {
    try {
      const response = await cache.match(url);
      if (response?.ok) {
        return await response.arrayBuffer();
      }
      return null;
    } catch (error) {
      console.error("Failed to get data from cache:", error);
      return null;
    }
  }

  private async fetchAndCacheBuffer(
    context: BaseContext,
    url: string,
    cache: Cache,
    validators?: CacheValidators,
    signal?: AbortSignal,
    callbacks?: Pick<CacheCallbacks, "onCacheHit">,
  ): Promise<ArrayBuffer> {
    const etag = validators?.etag;
    const lastModified = validators?.lastModified;
    const headers = new Headers();
    if (etag) headers.append("If-None-Match", etag);
    if (lastModified) headers.append("If-Modified-Since", lastModified);

    console.debug(`[AudioCache] Fetching ${url}`, {
      headers: Object.fromEntries(headers.entries()),
      hasEtag: !!etag,
      hasLastModified: !!lastModified,
    });

    const fetchResponse = await fetch(url, { headers, signal });

    console.debug(`[AudioCache] Response ${url}`, {
      status: fetchResponse.status,
      statusText: fetchResponse.statusText,
      etag: fetchResponse.headers?.get("ETag"),
      lastModified: fetchResponse.headers?.get("Last-Modified"),
      cacheControl: fetchResponse.headers?.get("Cache-Control"),
    });

    if (fetchResponse.status === 304) {
      const cachedResponse = await cache.match(url);
      if (cachedResponse) {
        // Emit cache hit for 304 responses
        if (callbacks?.onCacheHit) {
          const event: CacheHitEvent = {
            url,
            cacheType: "conditional",
            timestamp: Date.now(),
          };
          callbacks.onCacheHit(event);
        }

        // Update metadata timestamp on revalidation
        const timestamp = Date.now();
        const newCacheControl = fetchResponse.headers?.get("Cache-Control");
        await AudioCache.updateMetadata(cache, url, {
          timestamp,
          etag,
          lastModified,
          // Only update cacheControl if present in response, otherwise preserve existing
          ...(newCacheControl ? { cacheControl: newCacheControl } : {}),
        });
        return await cachedResponse.arrayBuffer();
      } else {
        // Cache inconsistency: 304 response but no cached body
        // This can happen if cache was partially corrupted or cleared
        // Fall back to re-fetching without validation headers
        console.warn(`Cache inconsistency detected for ${url}: 304 response but no cached body. Re-fetching.`);

        // Re-fetch without validation headers to get fresh content
        const freshResponse = await fetch(url, { signal });
        if (freshResponse.status === 200) {
          const responseClone = freshResponse.clone();
          const newEtag = freshResponse.headers.get("ETag");
          const newLastModified = freshResponse.headers.get("Last-Modified");
          const newCacheControl = freshResponse.headers.get("Cache-Control");

          await AudioCache.writeBufferAndMetadata(cache, url, responseClone, {
            timestamp: Date.now(),
            etag: newEtag || undefined,
            lastModified: newLastModified || undefined,
            cacheControl: newCacheControl || undefined,
          });

          // Use progress tracking for cache recovery scenario if body exists
          if (freshResponse.body) {
            const { stream, total } = this.createProgressTrackingStream(context, freshResponse, url, signal);
            return await AudioCache.collectStreamToArrayBuffer(stream, total || undefined);
          } else {
            // Fallback for mock responses without body (testing scenario)
            return await freshResponse.arrayBuffer();
          }
        } else {
          throw new Error(
            `Failed to fetch resource after cache inconsistency: ${freshResponse.status} ${freshResponse.statusText}`,
          );
        }
      }
    }

    if (fetchResponse.status === 200) {
      const responseClone = fetchResponse.clone();
      const newEtag = fetchResponse.headers.get("ETag");
      const newLastModified = fetchResponse.headers.get("Last-Modified");
      const newCacheControl = fetchResponse.headers.get("Cache-Control");

      await AudioCache.writeBufferAndMetadata(cache, url, responseClone, {
        timestamp: Date.now(),
        etag: newEtag || undefined,
        lastModified: newLastModified || undefined,
        cacheControl: newCacheControl || undefined,
      });
    }

    if (signal?.aborted) {
      throw new DOMException("Operation was aborted", "AbortError");
    }

    // Use progress tracking for the main response if body exists
    if (fetchResponse.body) {
      const { stream, total } = this.createProgressTrackingStream(context, fetchResponse, url, signal);
      return await AudioCache.collectStreamToArrayBuffer(stream, total || undefined);
    } else {
      // Fallback for mock responses without body (testing scenario)
      return await fetchResponse.arrayBuffer();
    }
  }

  /**
   * Atomically write a response body and its metadata into the cache.
   * On failure, deletes both partial entries (best-effort via `allSettled`)
   * and rethrows the original error.
   */
  private static async writeBufferAndMetadata(
    cache: Cache,
    url: string,
    response: Response,
    metadata: Partial<CacheMetadata>,
  ): Promise<void> {
    try {
      await Promise.all([cache.put(url, response), AudioCache.updateMetadata(cache, url, metadata)]);
    } catch (error) {
      // Clean up partial cache entries on error; both deletes run regardless.
      await Promise.allSettled([cache.delete(url), cache.delete(metaKey(url))]);
      throw error;
    }
  }

  /**
   * Creates a ReadableStream wrapper that tracks download progress.
   * Uses the callback aggregation system to emit progress to all registered listeners.
   * Honours `signal` between reads and releases the underlying reader on
   * any exit path (done, error, abort).
   * @param response - The fetch Response object with ReadableStream body
   * @param url - URL being downloaded (for progress event data and callback lookup)
   * @param signal - Optional AbortSignal observed at chunk boundaries
   * @returns Object containing the progress-tracking stream and total size
   */
  private createProgressTrackingStream(
    context: BaseContext,
    response: Response,
    url: string,
    signal?: AbortSignal,
  ): { stream: ReadableStream<Uint8Array>; total: number | null } {
    // Extract Content-Length from response headers
    const contentLengthHeader = response.headers.get("content-length");
    const total = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : null;

    let loaded = 0;

    if (!response.body) {
      // Fallback for responses without body - shouldn't happen for audio files
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const pendingCallbacks = this.pendingCallbacks.get(context);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          while (true) {
            if (signal?.aborted) {
              throw new DOMException("Operation was aborted", "AbortError");
            }
            const { done, value } = await reader.read();
            if (done) {
              // Emit final progress event at 100%
              AudioCache.callAllCallbacks(pendingCallbacks, url, "onLoadingProgress", {
                url,
                loaded,
                total,
                progress: total ? 1 : -1, // 100% if total known, -1 if unknown
                timestamp: Date.now(),
              } satisfies LoadingProgressEvent);
              controller.close();
              return;
            }

            if (value) {
              loaded += value.byteLength;

              // Emit progress event
              const progress = total ? loaded / total : -1;
              AudioCache.callAllCallbacks(pendingCallbacks, url, "onLoadingProgress", {
                url,
                loaded,
                total,
                progress,
                timestamp: Date.now(),
              } satisfies LoadingProgressEvent);

              controller.enqueue(value);
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },

      cancel(reason) {
        // Clean up reader when stream is cancelled
        return reader.cancel(reason);
      },
    });

    return { stream, total };
  }

  /**
   * Collects all chunks from a ReadableStream into a single ArrayBuffer
   * @param stream - The ReadableStream to collect from
   * @returns Promise that resolves to the complete ArrayBuffer
   */
  private static async collectStreamToArrayBuffer(
    stream: ReadableStream<Uint8Array>,
    knownLength?: number,
  ): Promise<ArrayBuffer> {
    const reader = stream.getReader();

    try {
      if (knownLength !== undefined && knownLength > 0) {
        // Pre-allocation path: we know the exact size
        const result = new ArrayBuffer(knownLength);
        const uint8View = new Uint8Array(result);
        let offset = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            uint8View.set(value, offset);
            offset += value.byteLength;
          }
        }

        return result;
      } else {
        // Exponential growth path: unknown size
        let buffer = new Uint8Array(8192); // Start with 8KB
        let totalLength = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            // Grow buffer if needed
            if (totalLength + value.byteLength > buffer.length) {
              const newSize = Math.max(buffer.length * 2, totalLength + value.byteLength);
              const newBuffer = new Uint8Array(newSize);
              newBuffer.set(buffer.subarray(0, totalLength));
              buffer = newBuffer;
            }

            buffer.set(value, totalLength);
            totalLength += value.byteLength;
          }
        }

        // Return exact-sized ArrayBuffer
        return buffer.slice(0, totalLength).buffer;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Fetch + decode an audio URL WITHOUT touching the persistent Cache API.
   * Used when the Cache API global (`caches`) is unavailable (e.g. Node).
   *
   * Mirrors the network branch of {@link fetchAndCacheBuffer}/{@link getAudioBuffer}
   * but never reads from or writes to `caches`. Still:
   * - uses the in-memory decoded-buffer LRU (write happens in {@link getAudioBuffer}),
   * - emits progress callbacks via {@link createProgressTrackingStream},
   * - is deduped through {@link getOrCreatePendingRequest} by the caller.
   */
  private async fetchAndDecodeWithoutCache(
    context: BaseContext,
    url: string,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const fetchResponse = await fetch(url, { signal });

    if (fetchResponse.status !== 200 && !fetchResponse.ok) {
      throw new Error(`Failed to fetch resource: ${fetchResponse.status} ${fetchResponse.statusText}`);
    }

    if (signal?.aborted) {
      throw new DOMException("Operation was aborted", "AbortError");
    }

    // Use progress tracking for the response if body exists
    if (fetchResponse.body) {
      const { stream, total } = this.createProgressTrackingStream(context, fetchResponse, url, signal);
      return await AudioCache.collectStreamToArrayBuffer(stream, total || undefined);
    }
    // Fallback for mock responses without body (testing scenario)
    return await fetchResponse.arrayBuffer();
  }

  private static async decodeAudioData(context: BaseContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    try {
      return await context.decodeAudioData(arrayBuffer);
    } catch (error) {
      console.error("Failed to decode audio data:", error);
      throw error;
    }
  }

  private static async getMetadataFromCache(url: string, cache: Cache): Promise<CacheMetadata | null> {
    try {
      const metaResponse = await cache.match(metaKey(url));
      if (metaResponse?.ok) {
        return await metaResponse.json();
      }
      return null;
    } catch (error) {
      console.error("Failed to get metadata from cache:", error);
      return null;
    }
  }

  /**
   * Get an AudioBuffer for the specified URL, using intelligent caching strategies.
   *
   * Caching Flow:
   * 1. Check memory cache (LRU) for decoded AudioBuffer
   * 2. Check persistent cache for raw ArrayBuffer and metadata
   * 3. Make conditional HTTP request if validation tokens available
   * 4. Decode audio data and cache at all levels
   *
   * The cache prioritizes HTTP conditional requests (ETag/Last-Modified) over TTL
   * to ensure content freshness while maintaining performance through 304 responses.
   *
   * @param context - AudioContext for decoding audio data
   * @param url - URL of the audio resource to fetch
   * @param signal - Optional AbortSignal to cancel the operation
   * @returns Promise that resolves to decoded AudioBuffer
   * @throws Error if audio cannot be fetched or decoded
   */
  public async getAudioBuffer(
    context: BaseContext,
    url: string,
    signal?: AbortSignal,
    callbacks?: CacheCallbacks,
  ): Promise<AudioBuffer> {
    let decodedBuffers = this.decodedBuffers.get(context);
    if (decodedBuffers === undefined) {
      decodedBuffers = new ByteBoundedLRUCache<string, AudioBuffer>(
        DEFAULT_DECODED_BUFFER_CACHE_BYTES,
        estimateAudioBufferBytes,
      );
      this.decodedBuffers.set(context, decodedBuffers);
    }

    // Call loading start callback
    if (callbacks?.onLoadingStart) {
      callbacks.onLoadingStart({
        url,
        timestamp: Date.now(),
      });
    }

    // Check if the decoded buffer is already available in memory cache.
    // Single get + narrow avoids the has/get/`!` race.
    const memoryHit = decodedBuffers.get(url);
    if (memoryHit !== undefined) {
      if (callbacks?.onCacheHit) {
        callbacks.onCacheHit({
          url,
          cacheType: "memory",
          timestamp: Date.now(),
        });
      }
      return memoryHit;
    }

    // handle data: urls
    if (url.startsWith("data:")) {
      const parsed = parseDataUrl(url);
      if (parsed === null) {
        const error = new Error(`Malformed data: URL: ${url.slice(0, 32)}…`);
        if (callbacks?.onLoadingError) {
          callbacks.onLoadingError({
            url,
            error,
            errorType: "decode",
            timestamp: Date.now(),
          });
        }
        throw error;
      }
      const audioBuffer = await AudioCache.decodeAudioData(context, parsed.bytes.buffer as ArrayBuffer);
      decodedBuffers.set(url, audioBuffer);
      return audioBuffer;
    }

    // When the browser Cache API is unavailable (e.g. Node), transparently
    // degrade to a fetch-only path: no persistent cache read/write, no error
    // log — still using the in-memory LRU, pending-request dedup, and progress
    // callbacks. The available-cache path below is byte-for-byte unchanged.
    if (!AudioCache.isCacheApiAvailable()) {
      return this.getOrCreatePendingRequest(
        context,
        url,
        async () => {
          // No persistent cache, so this is always a miss.
          if (callbacks?.onCacheMiss) {
            callbacks.onCacheMiss({
              url,
              reason: "not-found",
              timestamp: Date.now(),
            });
          }

          try {
            const arrayBuffer = await this.fetchAndDecodeWithoutCache(context, url, signal);
            let audioBuffer: AudioBuffer;
            try {
              audioBuffer = await AudioCache.decodeAudioData(context, arrayBuffer);
            } catch (error) {
              if (callbacks?.onLoadingError) {
                callbacks.onLoadingError({
                  url,
                  error: toError(error),
                  errorType: "decode",
                  timestamp: Date.now(),
                });
              }
              throw error;
            }
            if (callbacks?.onLoadingComplete) {
              callbacks.onLoadingComplete({
                url,
                duration: audioBuffer.duration,
                size: arrayBuffer.byteLength,
                timestamp: Date.now(),
              });
            }
            decodedBuffers.set(url, audioBuffer);
            return audioBuffer;
          } catch (error) {
            if (callbacks?.onLoadingError) {
              callbacks.onLoadingError({
                url,
                error: toError(error),
                errorType: getNetworkErrorType(error),
                timestamp: Date.now(),
              });
            }
            throw error;
          }
        },
        signal,
        { onLoadingProgress: callbacks?.onLoadingProgress },
      );
    }

    const cache = await AudioCache.openCache();

    const metadata = await AudioCache.getMetadataFromCache(url, cache);

    // Determine if we should make a network request
    // This logic implements HTTP caching best practices:
    // 1. Check Cache-Control freshness first (RFC-compliant behavior)
    // 2. If stale, use validation headers for conditional requests
    // 3. Fall back to TTL when no validation tokens exist
    const shouldFetch = (() => {
      if (!metadata) {
        return true; // Must fetch if nothing is cached
      }

      // Check for directives that require revalidation
      if (requiresRevalidation(metadata.cacheControl)) {
        return true; // Must revalidate due to no-cache, no-store, or must-revalidate
      }

      // Check Cache-Control freshness
      const maxAge = parseMaxAge(metadata.cacheControl);
      if (maxAge !== null) {
        const age = (Date.now() - metadata.timestamp) / 1000;
        if (maxAge > 0 && age < maxAge) {
          return false; // Fresh content, serve from cache
        }
        // If max-age=0 or content is stale, proceed to validation
      }

      // Content is stale (or max-age=0), check if we can revalidate
      if (metadata.etag || metadata.lastModified) {
        return true; // Stale but can be validated with conditional request
      }

      // No validation headers available, fall back to TTL
      return Date.now() - metadata.timestamp > AudioCache.cacheExpirationTime;
    })();

    return this.getOrCreatePendingRequest(
      context,
      url,
      async () => {
        if (shouldFetch) {
          // Cache miss - need to fetch from network
          if (callbacks?.onCacheMiss) {
            callbacks.onCacheMiss({
              url,
              reason: metadata ? "expired" : "not-found",
              timestamp: Date.now(),
            });
          }

          try {
            const arrayBuffer = await this.fetchAndCacheBuffer(
              context,
              url,
              cache,
              { etag: metadata?.etag, lastModified: metadata?.lastModified },
              signal,
              { onCacheHit: callbacks?.onCacheHit },
            );
            let audioBuffer: AudioBuffer;
            try {
              audioBuffer = await AudioCache.decodeAudioData(context, arrayBuffer);
            } catch (error) {
              if (callbacks?.onLoadingError) {
                callbacks.onLoadingError({
                  url,
                  error: toError(error),
                  errorType: "decode",
                  timestamp: Date.now(),
                });
              }
              throw error;
            }
            if (callbacks?.onLoadingComplete) {
              callbacks.onLoadingComplete({
                url,
                duration: audioBuffer.duration,
                size: arrayBuffer.byteLength,
                timestamp: Date.now(),
              });
            }
            decodedBuffers.set(url, audioBuffer);
            return audioBuffer;
          } catch (error) {
            if (callbacks?.onLoadingError) {
              callbacks.onLoadingError({
                url,
                error: toError(error),
                errorType: getNetworkErrorType(error),
                timestamp: Date.now(),
              });
            }
            if (callbacks?.onCacheError) {
              callbacks.onCacheError({
                url,
                error: toError(error),
                operation: "get",
                timestamp: Date.now(),
              });
            }
            throw error;
          }
        } else {
          // Content should be fresh in cache
          const cachedBuffer = await AudioCache.getBufferFromCache(url, cache);
          if (cachedBuffer) {
            // Cache hit from browser cache
            if (callbacks?.onCacheHit) {
              callbacks.onCacheHit({
                url,
                cacheType: "browser",
                timestamp: Date.now(),
              });
            }

            const audioBuffer = await AudioCache.decodeAudioData(context, cachedBuffer);
            decodedBuffers.set(url, audioBuffer);
            return audioBuffer;
          } else {
            // Cache inconsistency - metadata exists but body is missing
            if (callbacks?.onCacheError) {
              callbacks.onCacheError({
                url,
                error: new Error("Cache inconsistency: metadata exists but body is missing"),
                operation: "get",
                timestamp: Date.now(),
              });
            }

            // Fallback to network if body missing but metadata is fresh
            try {
              const arrayBuffer = await this.fetchAndCacheBuffer(
                context,
                url,
                cache,
                { etag: metadata?.etag, lastModified: metadata?.lastModified },
                signal,
                { onCacheHit: callbacks?.onCacheHit },
              );
              let audioBuffer: AudioBuffer;
              try {
                audioBuffer = await AudioCache.decodeAudioData(context, arrayBuffer);
              } catch (error) {
                if (callbacks?.onLoadingError) {
                  callbacks.onLoadingError({
                    url,
                    error: toError(error),
                    errorType: "decode",
                    timestamp: Date.now(),
                  });
                }
                throw error;
              }
              if (callbacks?.onLoadingComplete) {
                callbacks.onLoadingComplete({
                  url,
                  duration: audioBuffer.duration,
                  size: arrayBuffer.byteLength,
                  timestamp: Date.now(),
                });
              }
              decodedBuffers.set(url, audioBuffer);
              return audioBuffer;
            } catch (error) {
              if (callbacks?.onLoadingError) {
                callbacks.onLoadingError({
                  url,
                  error: toError(error),
                  errorType: getNetworkErrorType(error),
                  timestamp: Date.now(),
                });
              }
              throw error;
            }
          }
        }
      },
      signal,
      { onLoadingProgress: callbacks?.onLoadingProgress },
    );
  }

  public clearMemoryCache(): void {
    this.decodedBuffers = new WeakMap();
    this.pendingRequests = new WeakMap();
    this.pendingCallbacks = new WeakMap();
  }
}
