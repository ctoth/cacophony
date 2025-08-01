import { AudioContext, AudioBuffer } from "standardized-audio-context-mock";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { Cacophony } from "./cacophony";

export let cacophony: Cacophony;
export let audioContextMock: AudioContext;

const mockCache = {
  getAudioBuffer: vi.fn((context, url, signal, callbacks) => {
    
    // Call loading start callback immediately
    if (callbacks?.onLoadingStart) {
      callbacks.onLoadingStart({ url, timestamp: Date.now() });
    }

    // Simulate async loading behavior
    return new Promise(async (resolve, reject) => {
      try {
        // Check if this is an error test scenario based on global fetch mock or AudioContext mock
        if (global.fetch && typeof global.fetch === 'function') {
          // Only call fetch for valid URLs (including relative URLs)
          let shouldFetch = true;
          let testResponse;
          
          // Allow relative URLs and absolute URLs
          if (!url || url === 'test') {
            // Skip obviously invalid URLs like the debug test URL
            shouldFetch = false;
          }
          
          // Try fetch first if URL is valid
          if (shouldFetch) {
            try {
              testResponse = await global.fetch(url, { signal });
            } catch (fetchError) {
              // Call error callback for fetch failures
              if (callbacks?.onLoadingError) {
                const errorType = fetchError.name === 'AbortError' ? 'abort' : 'network';
                callbacks.onLoadingError({
                  url,
                  error: fetchError,
                  errorType,
                  timestamp: Date.now(),
                });
              }
              reject(fetchError);
              return; // Exit early on fetch error
            }
          }
          
          // Call progress callback if fetch succeeded or was skipped
          if (callbacks?.onLoadingProgress) {
            callbacks.onLoadingProgress({
              url,
              loaded: 512,
              total: 1024,
              progress: 0.5,
              timestamp: Date.now(),
            });
          }
          
          // Now check if decodeAudioData will fail
          const audioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
          
          // Test decode by calling the mocked decodeAudioData
          if (context.decodeAudioData && typeof context.decodeAudioData === 'function') {
            try {
              await context.decodeAudioData(new ArrayBuffer(1024));
              
              // Decode succeeded - call complete callback
              if (callbacks?.onLoadingComplete) {
                callbacks.onLoadingComplete({ 
                  url, 
                  duration: 2.27, 
                  size: 1024, 
                  timestamp: Date.now() 
                });
              }
              
              resolve(audioBuffer);
            } catch (decodeError) {
              // Decode failed - call error callback
              if (callbacks?.onLoadingError) {
                callbacks.onLoadingError({
                  url,
                  error: decodeError,
                  errorType: 'decode',
                  timestamp: Date.now(),
                });
              }
              reject(decodeError);
            }
          } else {
            // No decode mock - simulate successful load
            if (callbacks?.onLoadingComplete) {
              callbacks.onLoadingComplete({ 
                url, 
                duration: 2.27, 
                size: 1024, 
                timestamp: Date.now() 
              });
            }
            
            resolve(audioBuffer);
          }
        } else {
          // No fetch mock - simulate successful load
          if (callbacks?.onLoadingComplete) {
            callbacks.onLoadingComplete({ 
              url, 
              duration: 2.27, 
              size: 1024, 
              timestamp: Date.now() 
            });
          }
          
          const audioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
          resolve(audioBuffer);
        }
      } catch (error) {
        reject(error);
      }
    });
  }),
  clearMemoryCache: vi.fn(),
};

beforeAll(() => {
  vi.useFakeTimers();
  
  // Mock Audio constructor for HTML audio tests
  global.Audio = vi.fn().mockImplementation(() => ({
    src: '',
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
  vi.resetAllMocks();
  audioContextMock = new AudioContext();
  cacophony = new Cacophony(audioContextMock, mockCache);
});

afterEach(() => {
  audioContextMock.close();
});

export { mockCache };
