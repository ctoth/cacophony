import { IAudioContext } from "standardized-audio-context";

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

    private static async getAudioBufferFromCache(url: string, cache: Cache, context: IAudioContext): Promise<AudioBuffer | null> {
        try {
            const response = await cache.match(url);
            if (response) {
                const arrayBuffer = await response.arrayBuffer();
                return context.decodeAudioData(arrayBuffer);
            }
            return null;
        } catch (error) {
            console.error('Failed to get audio data from cache:', error);
            throw error;
        }
    }

    private static async fetchAndCacheAudioBuffer(url: string, cache: Cache, context: IAudioContext): Promise<AudioBuffer> {
        try {
            const fetchResponse = await fetch(url);
            const responseClone = fetchResponse.clone();
            cache.put(url, responseClone);
            const arrayBuffer = await fetchResponse.arrayBuffer();
            return context.decodeAudioData(arrayBuffer);
        } catch (error) {
            console.error('Failed to fetch and cache audio data:', error);
            throw error;
        }
    }

    public static async getAudioBuffer(url: string, context: IAudioContext): Promise<AudioBuffer> {
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

        // If it's not in the cache, fetch and cache it.
        pendingRequest = this.fetchAndCacheAudioBuffer(url, cache, context);
        this.pendingRequests.set(url, pendingRequest);

        return pendingRequest;
    }
}
