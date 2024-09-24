import { AudioContext } from "standardized-audio-context-mock";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { Cacophony } from "./cacophony";

export let cacophony: Cacophony;
export let audioContextMock: AudioContext;

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  audioContextMock = new AudioContext();
  cacophony = new Cacophony(audioContextMock);
});

afterEach(() => {
  audioContextMock.close();
});
