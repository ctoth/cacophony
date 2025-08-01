import { AudioContext, AudioBuffer } from "standardized-audio-context-mock";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { Cacophony } from "./cacophony";

export let cacophony: Cacophony;
export let audioContextMock: AudioContext;

const mockCache = {
  getAudioBuffer: vi
    .fn()
    .mockImplementation((context, url, signal, callbacks) => {
      // Call the callbacks if provided
      if (callbacks?.onLoadingStart) {
        callbacks.onLoadingStart({ url, timestamp: Date.now() });
      }
      if (callbacks?.onLoadingComplete) {
        setTimeout(() => {
          callbacks.onLoadingComplete({ 
            url, 
            duration: 2.27, 
            size: 1024, 
            timestamp: Date.now() 
          });
        }, 0);
      }
      return Promise.resolve(new AudioBuffer({ length: 100, sampleRate: 44100 }));
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
