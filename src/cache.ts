import type { AudioContext } from "./context";
import { ICache } from "./interfaces/ICache";

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

export class AudioCache {
  private static pendingRequests = new Map<string, Promise<AudioBuffer>>();
  private static decodedBuffers = new LRUCache<string, AudioBuffer>(
    DEFAULT_CACHE_SIZE
  );
  private static cacheExpirationTime: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

  public static setCacheExpirationTime(time: number): void {
    this.cacheExpirationTime = time;
  }

  private static async openCache(): Promise<Cache> {
    if (typeof caches === "undefined") {
      throw new Error("Cache API is not supported in this environment.");
    }
    try {
      return await caches.open("audio-cache");
    } catch (error) {
      console.error("Failed to open cache:", error);
      throw error;
    }
  }

  private static async getBufferFromCache(
    url: string,
    cache: Cache
  ): Promise<ArrayBuffer | null> {
    try {
      const response = await cache.match(url);
      const metaResponse = await cache.match(url + ":meta");

      if (!response || !metaResponse) {
        // Invalidate both cache entries if one is missing
        await cache.delete(url);
        await cache.delete(url + ":meta");
        return null;
      }

      if (!response.ok) {
        throw new Error(`Cached response not ok: ${response.status}`);
      }

      const metadata = await metaResponse.json();
      if (!metadata || typeof metadata.timestamp !== "number") {
        throw new Error("Invalid cache metadata");
      }

      return await response.arrayBuffer();
    } catch (error) {
      console.error(`Failed to get data from cache for URL ${url}:`, error);
      await cache.delete(url);
      await cache.delete(url + ":meta");
      return null;
    }
  }

  private static async fetchAndCacheBuffer(
    url: string,
    cache: Cache,
    etag?: string,
    lastModified?: string
  ): Promise<ArrayBuffer> {
    try {
      const headers = new Headers();
      if (etag) headers.append("If-None-Match", etag);
      if (lastModified) headers.append("If-Modified-Since", lastModified);

      const fetchResponse = await fetch(url, { headers });

      if (fetchResponse.status === 200) {
        const responseClone = fetchResponse.clone();
        const newEtag = fetchResponse.headers.get("ETag") || undefined;
        const newLastModified =
          fetchResponse.headers.get("Last-Modified") || undefined;
        const cacheData: CacheMetadata = {
          url,
          etag: newEtag,
          lastModified: newLastModified,
          timestamp: Date.now(),
        };

        try {
          const serverDate = fetchResponse.headers.get("Date");
          const timestamp = serverDate
            ? new Date(serverDate).getTime()
            : Date.now();
          const cacheData: CacheMetadata = {
            url,
            etag: newEtag,
            lastModified: newLastModified,
            timestamp,
          };

          await Promise.all([
            cache.put(url, responseClone),
            cache.put(
              url + ":meta",
              new Response(JSON.stringify(cacheData), {
                headers: { "Content-Type": "application/json" },
              })
            ),
          ]);
        } catch (error) {
          console.error("Failed to store in cache:", error);
          // Attempt to clean up partial cache entries
          await cache.delete(url);
          await cache.delete(url + ":meta");
        }
        return await fetchResponse.arrayBuffer();
      }

      if (fetchResponse.status === 304) {
        // Get existing cached response
        const cachedResponse = await cache.match(url);
        if (!cachedResponse) {
          throw new Error("Cached response missing despite 304 Not Modified");
        }

        // Update metadata timestamp on successful revalidation
        const serverDate = fetchResponse.headers.get("Date");
        const timestamp = serverDate
          ? new Date(serverDate).getTime()
          : Date.now();
        const cacheData: CacheMetadata = {
          url,
          etag,
          lastModified,
          timestamp,
        };

        // Store updated metadata before returning cached data
        await cache.put(
          url + ":meta",
          new Response(JSON.stringify(cacheData), {
            headers: { "Content-Type": "application/json" },
          })
        );

        return await cachedResponse.arrayBuffer();
      }

      throw new Error(`Unexpected response status: ${fetchResponse.status}`);
    } catch (error) {
      console.error("Failed to fetch and cache data:", error);
      throw error;
    }
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
      if (!metaResponse || !metaResponse.ok) {
        return null;
      }
      try {
        const metadata = await metaResponse.json();
        if (!metadata || typeof metadata.timestamp !== "number") {
          throw new Error("Invalid metadata structure");
        }
        return metadata;
      } catch (error) {
        console.error("Failed to get metadata from cache:", error);
        // Clean up invalid metadata
        await cache.delete(url);
        await cache.delete(url + ":meta");
        return null;
      }
    } catch (error) {
      console.error("Failed to get metadata from cache:", error);
      return null;
    }
  }

  public static async getAudioBuffer(
    context: AudioContext,
    url: string
  ): Promise<AudioBuffer> {
    // Check if the decoded buffer is already available
    if (this.decodedBuffers.has(url)) {
      return this.decodedBuffers.get(url)!;
    }

    // handle data: urls
    if (url.startsWith("data:")) {
      const matches = url.match(/^data:(.*?)(;base64)?,(.*)$/);
      if (!matches) {
        throw new Error("Invalid data URL format");
      }
      const isBase64 = !!matches[2];
      const data = matches[3];
      const binaryString = isBase64 ? atob(data) : decodeURIComponent(data);
      const buffer = Uint8Array.from(binaryString, (c) =>
        c.charCodeAt(0)
      ).buffer;
      const audioBuffer = await this.decodeAudioData(context, buffer);
      this.decodedBuffers.set(url, audioBuffer);
      return audioBuffer;
    }

    // Use a helper method to get or create the pending request
    const pendingRequest = this.getOrCreatePendingRequest(url, async () => {
      const cache = await this.openCache();
      const metadata = await this.getMetadataFromCache(url, cache);
      let shouldFetch = false;

      if (metadata) {
        if (Date.now() - metadata.timestamp > this.cacheExpirationTime) {
          // Cache has expired, need to revalidate
          shouldFetch = true;
        } else {
          // Cache is valid, use cached data
          shouldFetch = false;
        }
      } else {
        // No metadata, need to fetch
        shouldFetch = true;
      }

      if (shouldFetch) {
        // If it's not in the cache or needs revalidation, fetch and cache it.
        const arrayBuffer = await this.fetchAndCacheBuffer(
          url,
          cache,
          metadata?.etag,
          metadata?.lastModified
        );
        const audioBuffer = await this.decodeAudioData(context, arrayBuffer);
        this.decodedBuffers.set(url, audioBuffer);
        return audioBuffer;
      } else {
        // Use cached version
        const cachedBuffer = await this.getBufferFromCache(url, cache);
        if (cachedBuffer) {
          const audioBuffer = await this.decodeAudioData(context, cachedBuffer);
          this.decodedBuffers.set(url, audioBuffer);
          return audioBuffer;
        } else {
          // Cached data missing; need to fetch
          const arrayBuffer = await this.fetchAndCacheBuffer(url, cache);
          const audioBuffer = await this.decodeAudioData(context, arrayBuffer);
          this.decodedBuffers.set(url, audioBuffer);
          return audioBuffer;
        }
      }
    });

    return pendingRequest;
  }

  private static getOrCreatePendingRequest(
    url: string,
    createRequest: () => Promise<AudioBuffer>
  ): Promise<AudioBuffer> {
    let pendingRequest = this.pendingRequests.get(url);
    if (!pendingRequest) {
      const requestPromise = (async () => {
        try {
          const result = await createRequest();
          return result;
        } catch (error) {
          console.error(`Error processing request for URL ${url}:`, error);
          throw error;
        } finally {
          // Only remove from pending requests after completely settled
          this.pendingRequests.delete(url);
        }
      })();
      this.pendingRequests.set(url, requestPromise);
      return requestPromise;
    }
    return pendingRequest;
  }

  public static clearMemoryCache(): void {
    this.decodedBuffers = new LRUCache<string, AudioBuffer>(DEFAULT_CACHE_SIZE);
    this.pendingRequests.clear();
  }
}
