import type { AudioContext } from './context';

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
            this.cache.delete(firstKey);
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
    private static decodedBuffers = new LRUCache<string, AudioBuffer>(DEFAULT_CACHE_SIZE);
    private static cacheExpirationTime: number = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    public static setCacheExpirationTime(time: number): void {
        this.cacheExpirationTime = time;
    }

    private static async openCache(): Promise<Cache> {
        try {
            return await caches.open('audio-cache');
        } catch (error) {
            console.error('Failed to open cache:', error);
            throw error;
        }
    }

    private static async getBufferFromCache(url: string, cache: Cache): Promise<ArrayBuffer | null> {
        try {
            const response = await cache.match(url);
            if (response && response.ok) {
                return await response.arrayBuffer();
            }
            return null;
        } catch (error) {
            console.error('Failed to get data from cache:', error);
            return null;
        }
    }

    private static async fetchAndCacheBuffer(url: string, cache: Cache, etag?: string, lastModified?: string): Promise<ArrayBuffer> {
        try {
            const headers = new Headers();
            if (etag) headers.append('If-None-Match', etag);
            if (lastModified) headers.append('If-Modified-Since', lastModified);

            const fetchResponse = await fetch(url, { headers });
            const responseClone = fetchResponse.clone();

            if (fetchResponse.status === 200) {
                const newEtag = fetchResponse.headers.get('ETag') || undefined;
                const newLastModified = fetchResponse.headers.get('Last-Modified') || undefined;
                const cacheData: CacheMetadata = { 
                    url, 
                    etag: newEtag, 
                    lastModified: newLastModified,
                    timestamp: Date.now()
                };

                await cache.put(url, responseClone);
                await cache.put(url + ':meta', new Response(JSON.stringify(cacheData), { headers: { 'Content-Type': 'application/json' } }));
            } else if (fetchResponse.status === 304) {
                const cachedResponse = await cache.match(url);
                if (cachedResponse) {
                    return await cachedResponse.arrayBuffer();
                }
            }

            return await fetchResponse.arrayBuffer();
        } catch (error) {
            console.error('Failed to fetch and cache data:', error);
            throw error;
        }
    }

    private static async decodeAudioData(context: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
        try {
            return await context.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error('Failed to decode audio data:', error);
            throw error;
        }
    }

    private static async getMetadataFromCache(url: string, cache: Cache): Promise<CacheMetadata | null> {
        try {
            const metaResponse = await cache.match(url + ':meta');
            if (metaResponse && metaResponse.ok) {
                return await metaResponse.json();
            }
            return null;
        } catch (error) {
            console.error('Failed to get metadata from cache:', error);
            return null;
        }
    }

    public static async getAudioBuffer(context: AudioContext, url: string): Promise<AudioBuffer> {
        // Check if the decoded buffer is already available
        if (this.decodedBuffers.has(url)) {
            return this.decodedBuffers.get(url)!;
        }

        // handle data: urls
        if (url.startsWith('data:')) {
            const base64Data = url.split(',')[1];
            const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)).buffer;
            const audioBuffer = await this.decodeAudioData(context, buffer);
            this.decodedBuffers.set(url, audioBuffer);
            return audioBuffer;
        }

        const cache = await this.openCache();

        // First, check if there's a pending request.
        let pendingRequest = this.pendingRequests.get(url);
        if (pendingRequest) {
            return pendingRequest;
        }

        // Check for cached metadata (ETag, Last-Modified)
        const metadata = await this.getMetadataFromCache(url, cache);
        let shouldFetch = !metadata;

        if (metadata) {
            if (metadata.etag || metadata.lastModified) {
                // Use ETag or Last-Modified for revalidation
                shouldFetch = false;
            } else if (metadata.timestamp) {
                // If timestamp exists, use expiration time
                shouldFetch = (Date.now() - metadata.timestamp) > this.cacheExpirationTime;
            } else {
                // If no timestamp, ETag, or Last-Modified, assume it's expired
                shouldFetch = true;
            }
        }

        if (shouldFetch) {
            // If it's not in the cache or needs revalidation, fetch and cache it.
            pendingRequest = this.fetchAndCacheBuffer(url, cache, metadata?.etag, metadata?.lastModified)
                .then(arrayBuffer => this.decodeAudioData(context, arrayBuffer))
                .then(audioBuffer => {
                    this.decodedBuffers.set(url, audioBuffer);
                    return audioBuffer;
                })
                .finally(() => {
                    this.pendingRequests.delete(url); // Cleanup pending request
                });
            this.pendingRequests.set(url, pendingRequest);

            return pendingRequest;
        } else {
            // Use cached version
            const cachedBuffer = await this.getBufferFromCache(url, cache);
            if (cachedBuffer) {
                const audioBuffer = await this.decodeAudioData(context, cachedBuffer);
                this.decodedBuffers.set(url, audioBuffer);
                return audioBuffer;
            }
        }

        // If we reach here, something went wrong
        throw new Error('Failed to retrieve audio buffer');
    }


    public static clearMemoryCache(): void {
        this.decodedBuffers = new LRUCache<string, AudioBuffer>(DEFAULT_CACHE_SIZE);
        this.pendingRequests.clear();
    }
}


