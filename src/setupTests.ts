import { AudioContext, AudioBuffer } from "standardized-audio-context-mock";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { Cacophony } from "./cacophony";

import { ICache } from './interfaces/ICache';

import { mockCacheStorage } from "./__tests__/mockUtils";


export let cacophony: Cacophony;
export let audioContextMock: AudioContext;

const mockCache: ICache = {
  getAudioBuffer: vi.fn().mockResolvedValue(new AudioBuffer({ length: 100, sampleRate: 44100 })),
  clearMemoryCache: vi.fn(),
};

beforeAll(() => {
  vi.useFakeTimers();
  // Mock Cache API
  global.caches = mockCacheStorage();
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.resetAllMocks();
  audioContextMock = new AudioContext();

  cacophony = new Cacophony(audioContextMock, mockCache);
  // Reset all mocks
  vi.clearAllMocks();

});

afterEach(() => {
  audioContextMock.close();
});

export { mockCache };
