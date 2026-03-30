import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { Cacophony } from "./cacophony";

export let cacophony: Cacophony;
export let audioContextMock: AudioContext;

// Track which URLs have been loaded to simulate cache behavior
const loadedUrls = new Set<string>();

const mockCache = {
  getAudioBuffer: vi.fn((context, url, signal, callbacks) => {
    // Call loading start callback immediately
    if (callbacks?.onLoadingStart) {
      callbacks.onLoadingStart({ url, timestamp: Date.now() });
    }

    // Check if this URL has been loaded before (memory cache simulation)
    const isMemoryCacheHit = loadedUrls.has(url);

    if (isMemoryCacheHit) {
      // Cache hit - return immediately
      if (callbacks?.onCacheHit) {
        callbacks.onCacheHit({
          url,
          cacheType: "memory",
          timestamp: Date.now(),
        });
      }

      const audioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      return Promise.resolve(audioBuffer);
    }

    // Cache miss - need to "fetch" and load
    if (callbacks?.onCacheMiss) {
      callbacks.onCacheMiss({
        url,
        reason: "not-found",
        timestamp: Date.now(),
      });
    }

    // Simulate async loading behavior — never hit the real network
    return new Promise(async (resolve, reject) => {
      try {
        // If a test has mocked global.fetch to throw, honour that for error-path tests
        if (vi.isMockFunction(global.fetch)) {
          try {
            await global.fetch(url, { signal });
          } catch (fetchError) {
            if (callbacks?.onLoadingError) {
              const errorType = fetchError.name === "AbortError" ? "abort" : "network";
              callbacks.onLoadingError({
                url,
                error: fetchError,
                errorType,
                timestamp: Date.now(),
              });
            }
            reject(fetchError);
            return;
          }
        }

        if (callbacks?.onLoadingProgress) {
          callbacks.onLoadingProgress({
            url,
            loaded: 512,
            total: 1024,
            progress: 0.5,
            timestamp: Date.now(),
          });
        }

        const audioBuffer = new AudioBuffer({
          length: 100,
          sampleRate: 44100,
        });

        // Test decode by calling the mocked decodeAudioData
        if (context.decodeAudioData && typeof context.decodeAudioData === "function") {
          try {
            await context.decodeAudioData(new ArrayBuffer(1024));

            if (callbacks?.onLoadingComplete) {
              callbacks.onLoadingComplete({
                url,
                duration: 2.27,
                size: 1024,
                timestamp: Date.now(),
              });
            }

            loadedUrls.add(url);
            resolve(audioBuffer);
          } catch (decodeError) {
            if (callbacks?.onLoadingError) {
              callbacks.onLoadingError({
                url,
                error: decodeError,
                errorType: "decode",
                timestamp: Date.now(),
              });
            }
            reject(decodeError);
          }
        } else {
          if (callbacks?.onLoadingComplete) {
            callbacks.onLoadingComplete({
              url,
              duration: 2.27,
              size: 1024,
              timestamp: Date.now(),
            });
          }

          loadedUrls.add(url);
          resolve(audioBuffer);
        }
      } catch (error) {
        reject(error);
      }
    });
  }),
  clearMemoryCache: vi.fn(() => {
    loadedUrls.clear();
  }),
};

beforeAll(() => {
  vi.useFakeTimers();

  // Mock Audio constructor for HTML audio tests
  global.Audio = vi.fn().mockImplementation(() => ({
    src: "",
    crossOrigin: null,
    load: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    currentTime: 0,
    duration: 0,
    loop: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  // Mock AudioWorkletNode constructor for worklet tests
  global.AudioWorkletNode = vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    port: {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
    },
  }));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  audioContextMock = new AudioContext();
  cacophony = new Cacophony(audioContextMock, mockCache);
});

afterEach(() => {
  audioContextMock.close();
});

export { mockCache };
