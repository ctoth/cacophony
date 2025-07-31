import type { AudioContext } from "./context";

class LRUCache<K, V> {
  private maxSize: number;
  private cache: Map<K, V>;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }
}

interface CacheMetadata {
  url: string;
  etag?: string;
  lastModified?: string;
  cacheControl?: string;
  timestamp: number;
}

const DEFAULT_CACHE_SIZE = 100;

/**
 * Parse max-age value from Cache-Control header
 * @param cacheControlHeader - The Cache-Control header value
 * @returns max-age in seconds, or null if not found
 */
function parseMaxAge(cacheControlHeader: string | undefined): number | null {
  if (!cacheControlHeader) {
    return null;
  }
  const match = cacheControlHeader.match(/max-age\s*=\s*"?(\d+)"?/i);
  return match ? parseInt(match[1], 10) : null;
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
  return /(?:^|,)\s*(no-cache|no-store|must-revalidate)\s*(?:,|$)/i.test(
    cacheControlHeader
  );
}

export interface ICache {
  getAudioBuffer(context: AudioContext, url: string, signal?: AbortSignal): Promise<AudioBuffer>;
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
  private static pendingRequests = new Map<string, Promise<AudioBuffer>>();
  private static decodedBuffers = new LRUCache<string, AudioBuffer>(
    DEFAULT_CACHE_SIZE
  );
  private static cacheExpirationTime: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  public static setCacheExpirationTime(time: number): void {
    this.cacheExpirationTime = time;
  }

  private static async openCache(): Promise<Cache> {
    try {
      return await caches.open("audio-cache");
    } catch (error) {
      console.error("Failed to open cache:", error);
      throw error;
    }
  }

  private static async getOrCreatePendingRequest(
    url: string,
    createRequest: () => Promise<AudioBuffer | undefined>,
    signal?: AbortSignal
  ): Promise<AudioBuffer> {
    if (signal?.aborted) {
      throw new DOMException('Operation was aborted', 'AbortError');
    }
    
    let pendingRequest = this.pendingRequests.get(url);
    if (!pendingRequest) {
      const requestPromise = (async () => {
        try {
          const result = await createRequest();
          if (result === undefined) {
            throw new Error("Failed to create audio buffer.");
          }
          return result;
        } finally {
          this.pendingRequests.delete(url);
        }
      })();
      
      // Clean up on abort
      signal?.addEventListener('abort', () => {
        if (signal.aborted) {
          this.pendingRequests.delete(url);
        }
      }, { once: true });
      
      this.pendingRequests.set(url, requestPromise);
      return requestPromise;
    }
    return pendingRequest;
  }

  private static async updateMetadata(
    cache: Cache,
    url: string,
    data: Partial<CacheMetadata>
  ): Promise<void> {
    const metadata: CacheMetadata = {
      url,
      timestamp: Date.now(),
      ...data,
    };

    await cache.put(
      `${url}:meta`,
      new Response(JSON.stringify(metadata), {
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  private static async getBufferFromCache(
    url: string,
    cache: Cache
  ): Promise<ArrayBuffer | null> {
    try {
      const response = await cache.match(url);
      if (response && response.ok) {
        return await response.arrayBuffer();
      }
      return null;
    } catch (error) {
      console.error("Failed to get data from cache:", error);
      return null;
    }
  }

  private static async fetchAndCacheBuffer(
    url: string,
    cache: Cache,
    etag?: string,
    lastModified?: string,
    signal?: AbortSignal
  ): Promise<ArrayBuffer> {
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
        // Update metadata timestamp on revalidation
        const timestamp = Date.now();
        const newCacheControl = fetchResponse.headers?.get("Cache-Control");
        await this.updateMetadata(cache, url, {
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
        console.warn(
          `Cache inconsistency detected for ${url}: 304 response but no cached body. Re-fetching.`
        );

        // Re-fetch without validation headers to get fresh content
        const freshResponse = await fetch(url, { signal });
        if (freshResponse.status === 200) {
          const responseClone = freshResponse.clone();
          const newEtag = freshResponse.headers.get("ETag");
          const newLastModified = freshResponse.headers.get("Last-Modified");
          const newCacheControl = freshResponse.headers.get("Cache-Control");

          try {
            await Promise.all([
              cache.put(url, responseClone),
              this.updateMetadata(cache, url, {
                timestamp: Date.now(),
                etag: newEtag || undefined,
                lastModified: newLastModified || undefined,
                cacheControl: newCacheControl || undefined,
              }),
            ]);
          } catch (error) {
            // Clean up partial cache entries on error
            await cache.delete(url);
            await cache.delete(`${url}:meta`);
            throw error;
          }

          return await freshResponse.arrayBuffer();
        } else {
          throw new Error(
            `Failed to fetch resource after cache inconsistency: ${freshResponse.status} ${freshResponse.statusText}`
          );
        }
      }
    }

    if (fetchResponse.status === 200) {
      const responseClone = fetchResponse.clone();
      const newEtag = fetchResponse.headers.get("ETag");
      const newLastModified = fetchResponse.headers.get("Last-Modified");
      const newCacheControl = fetchResponse.headers.get("Cache-Control");

      try {
        await Promise.all([
          cache.put(url, responseClone),
          this.updateMetadata(cache, url, {
            timestamp: Date.now(),
            etag: newEtag || undefined,
            lastModified: newLastModified || undefined,
            cacheControl: newCacheControl || undefined,
          }),
        ]);
      } catch (error) {
        // Clean up partial cache entries on error
        await cache.delete(url);
        await cache.delete(`${url}:meta`);
        throw error;
      }
    }

    if (signal?.aborted) {
      throw new DOMException('Operation was aborted', 'AbortError');
    }

    return await fetchResponse.arrayBuffer();
  }

  private static async decodeAudioData(
    context: AudioContext,
    arrayBuffer: ArrayBuffer
  ): Promise<AudioBuffer> {
    try {
      return await context.decodeAudioData(arrayBuffer);
    } catch (error) {
      console.error("Failed to decode audio data:", error);
      throw error;
    }
  }

  private static async getMetadataFromCache(
    url: string,
    cache: Cache
  ): Promise<CacheMetadata | null> {
    try {
      const metaResponse = await cache.match(url + ":meta");
      if (metaResponse && metaResponse.ok) {
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
    context: AudioContext,
    url: string,
    signal?: AbortSignal
  ): Promise<AudioBuffer> {
    // Check if the decoded buffer is already available in memory cache
    if (AudioCache.decodedBuffers.has(url)) {
      return AudioCache.decodedBuffers.get(url)!;
    }

    // handle data: urls
    if (url.startsWith("data:")) {
      const base64Data = url.split(",")[1];
      const buffer = Uint8Array.from(atob(base64Data), (c) =>
        c.charCodeAt(0)
      ).buffer;
      const audioBuffer = await AudioCache.decodeAudioData(context, buffer);
      AudioCache.decodedBuffers.set(url, audioBuffer);
      return audioBuffer;
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

    return AudioCache.getOrCreatePendingRequest(url, async () => {
      if (shouldFetch) {
        const arrayBuffer = await AudioCache.fetchAndCacheBuffer(
          url,
          cache,
          metadata?.etag,
          metadata?.lastModified,
          signal
        );
        const audioBuffer = await AudioCache.decodeAudioData(
          context,
          arrayBuffer
        );
        AudioCache.decodedBuffers.set(url, audioBuffer);
        return audioBuffer;
      } else {
        const cachedBuffer = await AudioCache.getBufferFromCache(url, cache);
        if (cachedBuffer) {
          const audioBuffer = await AudioCache.decodeAudioData(
            context,
            cachedBuffer
          );
          AudioCache.decodedBuffers.set(url, audioBuffer);
          return audioBuffer;
        } else {
          // Fallback to network if body missing but metadata is fresh
          const arrayBuffer = await AudioCache.fetchAndCacheBuffer(
            url,
            cache,
            metadata?.etag,
            metadata?.lastModified,
            signal
          );
          const audioBuffer = await AudioCache.decodeAudioData(
            context,
            arrayBuffer
          );
          AudioCache.decodedBuffers.set(url, audioBuffer);
          return audioBuffer;
        }
      }
    }, signal);
  }

  public clearMemoryCache(): void {
    AudioCache.decodedBuffers = new LRUCache<string, AudioBuffer>(
      DEFAULT_CACHE_SIZE
    );
    AudioCache.pendingRequests.clear();
  }
}
