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
  timestamp: number;
}

const DEFAULT_CACHE_SIZE = 100;
export interface ICache {
  getAudioBuffer(context: AudioContext, url: string): Promise<AudioBuffer>;
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
    createRequest: () => Promise<AudioBuffer | undefined>
  ): Promise<AudioBuffer> {
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
    lastModified?: string
  ): Promise<ArrayBuffer> {
    const headers = new Headers();
    if (etag) headers.append("If-None-Match", etag);
    if (lastModified) headers.append("If-Modified-Since", lastModified);

    const fetchResponse = await fetch(url, { headers });

    if (fetchResponse.status === 304) {
      const cachedResponse = await cache.match(url);
      if (cachedResponse) {
        // Update metadata timestamp on revalidation
        const timestamp = Date.now();
        await this.updateMetadata(cache, url, {
          timestamp,
          etag,
          lastModified,
        });
        return await cachedResponse.arrayBuffer();
      } else {
        // Cache inconsistency: 304 response but no cached body
        // This can happen if cache was partially corrupted or cleared
        // Fall back to re-fetching without validation headers
        console.warn(`Cache inconsistency detected for ${url}: 304 response but no cached body. Re-fetching.`);
        
        // Re-fetch without validation headers to get fresh content
        const freshResponse = await fetch(url);
        if (freshResponse.status === 200) {
          const responseClone = freshResponse.clone();
          const newEtag = freshResponse.headers.get("ETag");
          const newLastModified = freshResponse.headers.get("Last-Modified");

          try {
            await Promise.all([
              cache.put(url, responseClone),
              this.updateMetadata(cache, url, {
                timestamp: Date.now(),
                etag: newEtag || undefined,
                lastModified: newLastModified || undefined,
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
          throw new Error(`Failed to fetch resource after cache inconsistency: ${freshResponse.status} ${freshResponse.statusText}`);
        }
      }
    }

    if (fetchResponse.status === 200) {
      const responseClone = fetchResponse.clone();
      const newEtag = fetchResponse.headers.get("ETag");
      const newLastModified = fetchResponse.headers.get("Last-Modified");

      try {
        await Promise.all([
          cache.put(url, responseClone),
          this.updateMetadata(cache, url, {
            timestamp: Date.now(),
            etag: newEtag || undefined,
            lastModified: newLastModified || undefined,
          }),
        ]);
      } catch (error) {
        // Clean up partial cache entries on error
        await cache.delete(url);
        await cache.delete(`${url}:meta`);
        throw error;
      }
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
   * @returns Promise that resolves to decoded AudioBuffer
   * @throws Error if audio cannot be fetched or decoded
   */
  public async getAudioBuffer(
    context: AudioContext,
    url: string
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
    // - Always make conditional requests when validation tokens (ETag/Last-Modified) are available
    // - This allows servers to respond with lightweight 304 responses if content unchanged
    // - Only fall back to TTL when no validation tokens exist
    const shouldFetch =
      !metadata ||
      // Always make conditional requests when we have validation tokens (ETags/Last-Modified)
      metadata.etag ||
      metadata.lastModified ||
      // Only use TTL fallback when no validation tokens exist
      Date.now() - metadata.timestamp > AudioCache.cacheExpirationTime;

    return AudioCache.getOrCreatePendingRequest(url, async () => {
      if (shouldFetch) {
        const arrayBuffer = await AudioCache.fetchAndCacheBuffer(
          url,
          cache,
          metadata?.etag,
          metadata?.lastModified
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
        }
      }
    });
  }

  public clearMemoryCache(): void {
    AudioCache.decodedBuffers = new LRUCache<string, AudioBuffer>(
      DEFAULT_CACHE_SIZE
    );
    AudioCache.pendingRequests.clear();
  }
}
