/**
 * Tests for OfflineAudioContext support (GitHub issue #42).
 *
 * These tests verify the offline rendering API:
 * - Cacophony.createOffline() factory
 * - isOffline getter
 * - startRendering() method
 * - Buffer-based sounds on offline contexts
 * - Error handling for unsupported operations
 */

import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { describe, expect, it, vi } from "vitest";
import { Cacophony } from "./cacophony";
import type { BaseContext, AudioBuffer as CacophonyAudioBuffer } from "./context";

// Build a mock that satisfies BaseContext and has startRendering()
function createOfflineContextMock(length = 44100): BaseContext & { startRendering(): Promise<CacophonyAudioBuffer> } {
  const base = new AudioContext();
  const renderedBuffer = new AudioBuffer({ length, sampleRate: 44100 });

  return Object.assign(base, {
    startRendering: vi.fn().mockResolvedValue(renderedBuffer),
    length,
  }) as unknown as BaseContext & { startRendering(): Promise<CacophonyAudioBuffer> };
}

const mockCache = {
  getAudioBuffer: vi.fn((_context, _url, _signal, callbacks) => {
    if (callbacks?.onLoadingStart) {
      callbacks.onLoadingStart({ url: _url, timestamp: Date.now() });
    }
    const audioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    if (callbacks?.onLoadingComplete) {
      callbacks.onLoadingComplete({ url: _url, duration: 2.27, size: 1024, timestamp: Date.now() });
    }
    return Promise.resolve(audioBuffer);
  }),
  clearMemoryCache: vi.fn(),
};

describe("OfflineAudioContext support", () => {
  describe("Cacophony.createOffline()", () => {
    it("returns a Cacophony instance", () => {
      const offlineCtx = createOfflineContextMock(128);
      const cacophony = Cacophony.createOffline(
        { numberOfChannels: 1, length: 128, sampleRate: 44100, context: offlineCtx },
        mockCache,
      );
      expect(cacophony).toBeInstanceOf(Cacophony);
    });

    it("exposes the offline context", () => {
      const offlineCtx = createOfflineContextMock(128);
      const cacophony = Cacophony.createOffline(
        { numberOfChannels: 1, length: 128, sampleRate: 44100, context: offlineCtx },
        mockCache,
      );
      expect(cacophony.isOffline).toBe(true);
      expect(cacophony.context).toBe(offlineCtx);
    });

    it("forwards runtime options to worklet-backed effects", async () => {
      const offlineCtx = createOfflineContextMock(128);
      Object.defineProperty(offlineCtx, "audioWorklet", {
        value: { addModule: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });
      const createAudioWorkletNode = vi.fn(() => offlineCtx.createGain());
      const cacophony = Cacophony.createOffline(
        { numberOfChannels: 1, length: 128, sampleRate: 44100, context: offlineCtx },
        mockCache,
        { createAudioWorkletNode },
      );

      await cacophony.createReverb().build(offlineCtx);

      expect(createAudioWorkletNode).toHaveBeenCalledWith(
        offlineCtx,
        "dattorro-reverb",
        expect.objectContaining({ parameterData: {} }),
      );
    });
  });

  describe("isOffline", () => {
    it("returns true for offline context", () => {
      const offlineCtx = createOfflineContextMock();
      const cacophony = new Cacophony(offlineCtx, mockCache);
      expect(cacophony.isOffline).toBe(true);
    });

    it("returns false for live context", () => {
      const liveCtx = new AudioContext() as unknown as BaseContext;
      const cacophony = new Cacophony(liveCtx, mockCache);
      expect(cacophony.isOffline).toBe(false);
    });
  });

  describe("startRendering()", () => {
    it("returns a Promise that resolves to an AudioBuffer", async () => {
      const offlineCtx = createOfflineContextMock(44100 * 2);
      const cacophony = new Cacophony(offlineCtx, mockCache);
      const buffer = await cacophony.startRendering();
      expect(buffer).toBeDefined();
      expect(buffer.length).toBe(44100 * 2);
    });

    it("throws when called on a live context", async () => {
      const liveCtx = new AudioContext() as unknown as BaseContext;
      const cacophony = new Cacophony(liveCtx, mockCache);
      await expect(cacophony.startRendering()).rejects.toThrow(/offline/i);
    });
  });

  describe("buffer-based sounds on offline context", () => {
    it("can create a sound from an AudioBuffer", async () => {
      const offlineCtx = createOfflineContextMock();
      const cacophony = new Cacophony(offlineCtx, mockCache);
      const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 }) as unknown as CacophonyAudioBuffer;
      const sound = await cacophony.createSound(buffer, "buffer");
      expect(sound).toBeDefined();
    });

    it("can play a buffer-based sound", async () => {
      const offlineCtx = createOfflineContextMock();
      const cacophony = new Cacophony(offlineCtx, mockCache);
      const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 }) as unknown as CacophonyAudioBuffer;
      const sound = await cacophony.createSound(buffer, "buffer");
      const playbacks = sound.play();
      expect(playbacks.length).toBeGreaterThan(0);
      expect(playbacks[0].isPlaying).toBe(true);
    });

    it("schedules fades without waiting on a wall-clock timer", async () => {
      vi.useFakeTimers();
      try {
        const offlineCtx = createOfflineContextMock();
        const cacophony = new Cacophony(offlineCtx, mockCache);
        const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 }) as unknown as CacophonyAudioBuffer;
        const sound = await cacophony.createSound(buffer, "buffer");
        const [playback] = sound.play();

        const fade = playback.fadeTo(0.25, 10_000);

        expect(vi.getTimerCount()).toBe(0);
        await fade;
        expect(playback.isFading).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("createOscillator on offline context", () => {
    it("can create a synth on an offline context", () => {
      const offlineCtx = createOfflineContextMock();
      const cacophony = new Cacophony(offlineCtx, mockCache);
      const synth = cacophony.createOscillator({ frequency: 440, type: "sine" });
      expect(synth).toBeDefined();
    });
  });

  describe("pause/resume on offline context", () => {
    it("pause is a no-op when suspend is not available", () => {
      const offlineCtx = createOfflineContextMock();
      // Remove suspend to simulate OfflineAudioContext
      delete (offlineCtx as any).suspend;
      const cacophony = new Cacophony(offlineCtx, mockCache);
      // Should not throw
      expect(() => cacophony.pause()).not.toThrow();
    });

    it("resume is a no-op when resume is not available", () => {
      const offlineCtx = createOfflineContextMock();
      delete (offlineCtx as any).resume;
      const cacophony = new Cacophony(offlineCtx, mockCache);
      expect(() => cacophony.resume()).not.toThrow();
    });
  });
});
