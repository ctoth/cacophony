import { AudioContext, AudioBuffer } from './context';

export class CacheManager {
    private static pendingRequests = new Map<string, Promise<AudioBuffer>>();

    private static async openCache(): Promise<Cache> {
        try {
            return await caches.open('audio-cache');
        } catch (error) {
            console.error('Failed to open cache:', error);
            throw error;
        }
    }

    private static async getAudioBufferFromCache(url: string, cache: Cache, context: AudioContext): Promise<AudioBuffer | null> {
        try {
            const response = await cache.match(url);
            if (response) {
                if (!response.ok) {
                    throw new Error('Failed to get audio data from cache');
                }
                const arrayBuffer = await response.arrayBuffer();
                return context.decodeAudioData(arrayBuffer);
            }
            return null;
        } catch (error) {
            console.error('Failed to get audio data from cache:', error);
            throw error;
        }
    }

    private static async fetchAndCacheAudioBuffer(url: string, cache: Cache, context: AudioContext, etag?: string, lastModified?: string): Promise<AudioBuffer> {
        try {
            const headers = new Headers();
            if (etag) {
                headers.append('If-None-Match', etag);
            }
            if (lastModified) {
                headers.append('If-Modified-Since', lastModified);
            }
            const fetchResponse = await fetch(url, { headers });
            const responseClone = fetchResponse.clone();
            if (fetchResponse.status === 200) {
                const newEtag = fetchResponse.headers.get('ETag');
                const newLastModified = fetchResponse.headers.get('Last-Modified');
                const cacheData = { url, etag: newEtag, lastModified: newLastModified };
                cache.put(url, responseClone);
                cache.put(url + ':meta', new Response(JSON.stringify(cacheData)));
            } else if (fetchResponse.status === 304) {
                // The response has not been modified, use the cached version.
                const cachedResponse = await cache.match(url);
                if (cachedResponse) {
                    const arrayBuffer = await cachedResponse.arrayBuffer();
                    return context.decodeAudioData(arrayBuffer);
                }
            }
            const arrayBuffer = await fetchResponse.arrayBuffer();
            return context.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error('Failed to fetch and cache audio data:', error);
            throw error;
        }
    }

    public static async getAudioBuffer(url: string, context: AudioContext): Promise<AudioBuffer> {
        // handle data: urls
        if (url.startsWith('data:')) {
            // Extract the base64-encoded audio data from the url.
            const base64Data = url.split(',')[1];
            const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
            return context.decodeAudioData(buffer.buffer);
        }

        const cache = await this.openCache();

        // First, check if there's a pending request.
        let pendingRequest = this.pendingRequests.get(url);
        if (pendingRequest) {
            return pendingRequest;
        }

        // Try getting the buffer from cache.
        const bufferFromCache = await this.getAudioBufferFromCache(url, cache, context);
        if (bufferFromCache) {
            return bufferFromCache;
        }

        // Check for cached metadata (ETag, Last-Modified)
        const metaResponse = await cache.match(url + ':meta');
        let etag;
        let lastModified;
        if (metaResponse) {
            const metaData = await metaResponse.json();
            etag = metaData.etag;
            lastModified = metaData.lastModified;
        }

        // If it's not in the cache or needs revalidation, fetch and cache it.
        pendingRequest = this.fetchAndCacheAudioBuffer(url, cache, context, etag, lastModified);
        this.pendingRequests.set(url, pendingRequest);

        return pendingRequest;
    }
}
