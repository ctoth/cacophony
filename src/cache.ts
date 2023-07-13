
export class CacheManager {
    static pendingRequests = new Map<string, Promise<AudioBuffer>>();

    static async getAudioBuffer(url: string, context: AudioContext): Promise<AudioBuffer> {
        const cache = await this.safeOperation(() => caches.open('audio-cache'), 'Failed to open cache');

        const response = await this.safeOperation(() => cache.match(url), 'Failed to match cache');

        if (response) {
            const arrayBuffer = await this.safeOperation(() => response.arrayBuffer(), 'Failed to convert response to ArrayBuffer');
            const audioBuffer = await this.safeOperation(() => context.decodeAudioData(arrayBuffer), 'Failed to decode audio data');
            return audioBuffer;
        }

        let pendingRequest = this.pendingRequests.get(url);
        if (!pendingRequest) {
            const fetchResponse = await this.safeOperation(() => fetch(url), 'Failed to fetch request');
            cache.put(url, fetchResponse.clone());
            const arrayBuffer = await this.safeOperation(() => fetchResponse.arrayBuffer(), 'Failed to convert response to ArrayBuffer');
            pendingRequest = context.decodeAudioData(arrayBuffer);
            this.pendingRequests.set(url, pendingRequest);
        }

        return pendingRequest;
    }

    static async safeOperation<T>(operation: () => Promise<T>, errorMessage: string): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`${errorMessage}: ${error.message}`);
            }
            throw error; // Re-throw if it's not an Error, we don't know how to handle it.
        }
    }
}


