import { AudioContext, AudioBuffer } from "standardized-audio-context-mock";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { Cacophony } from "./cacophony";

export let cacophony: Cacophony;
export let audioContextMock: AudioContext;

vi.mock('./cache', () => ({
  AudioCache: {
    getAudioBuffer: vi.fn().mockResolvedValue(new AudioBuffer({ length: 100, sampleRate: 44100 })),
    clearMemoryCache: vi.fn(),
  },
}));

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.resetAllMocks();
  audioContextMock = new AudioContext();
  cacophony = new Cacophony(audioContextMock);
});

afterEach(() => {
  audioContextMock.close();
});

// Export mocked AudioCache for use in tests
export const { AudioCache } = require('./cache');
