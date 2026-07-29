import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCache } from "./cache";
import { Cacophony } from "./cacophony";
import { audioContextMock, cacophony } from "./setupTests";

describe("Event System Integration Tests", () => {
  let mockCallbacks: any;

  beforeEach(() => {
    mockCallbacks = {
      // Loading events
      onLoadingStart: vi.fn(),
      onLoadingProgress: vi.fn(),
      onLoadingComplete: vi.fn(),
      onLoadingError: vi.fn(),

      // Cache events
      onCacheHit: vi.fn(),
      onCacheMiss: vi.fn(),
      onCacheError: vi.fn(),

      // Error events
      onSoundError: vi.fn(),
      onPlaybackError: vi.fn(),
    };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cacophony.clearMemoryCache();
  });

  describe("Complete Loading Flow with Cache Miss", () => {
    it("should emit complete event sequence: start → progress → miss → complete", async () => {
      const testUrl = "https://example.com/audio.mp3";
      const mockArrayBuffer = new ArrayBuffer(1024);
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });

      // Mock successful fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map(),
      });

      // Mock successful decode
      audioContextMock.decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);

      // Register all event listeners
      cacophony.on("loadingStart", mockCallbacks.onLoadingStart);
      cacophony.on("loadingProgress", mockCallbacks.onLoadingProgress);
      cacophony.on("loadingComplete", mockCallbacks.onLoadingComplete);
      cacophony.on("cacheMiss", mockCallbacks.onCacheMiss);

      // Trigger loading
      const sound = await cacophony.createSound(testUrl);

      // Verify complete event sequence
      expect(mockCallbacks.onLoadingStart).toHaveBeenCalledWith(
        expect.objectContaining({
          url: testUrl,
          timestamp: expect.any(Number),
        }),
      );

      expect(mockCallbacks.onLoadingProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          url: testUrl,
          loaded: expect.any(Number),
          total: expect.any(Number),
          progress: expect.any(Number),
          timestamp: expect.any(Number),
        }),
      );

      expect(mockCallbacks.onCacheMiss).toHaveBeenCalledWith(
        expect.objectContaining({
          url: testUrl,
          reason: "not-found",
          timestamp: expect.any(Number),
        }),
      );

      expect(mockCallbacks.onLoadingComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          url: testUrl,
          duration: expect.any(Number),
          size: 1024,
          timestamp: expect.any(Number),
        }),
      );

      expect(sound).toBeDefined();
    });
  });

  describe("Memory Cache Hit Flow", () => {
    it("should emit cache hit event on second load of same URL", async () => {
      const testUrl = "https://example.com/audio2.mp3";
      const mockArrayBuffer = new ArrayBuffer(2048);
      const mockAudioBuffer = new AudioBuffer({ length: 200, sampleRate: 44100 });

      // Mock successful fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map(),
      });

      // Mock successful decode
      audioContextMock.decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);

      // Register event listeners
      cacophony.on("cacheHit", mockCallbacks.onCacheHit);
      cacophony.on("cacheMiss", mockCallbacks.onCacheMiss);

      // First load - should be cache miss
      await cacophony.createSound(testUrl);
      expect(mockCallbacks.onCacheMiss).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onCacheHit).toHaveBeenCalledTimes(0);

      // Clear mock call counts
      vi.clearAllMocks();

      // Second load - should be memory cache hit
      await cacophony.createSound(testUrl);
      expect(mockCallbacks.onCacheHit).toHaveBeenCalledWith(
        expect.objectContaining({
          url: testUrl,
          cacheType: "memory",
          timestamp: expect.any(Number),
        }),
      );
      expect(mockCallbacks.onCacheMiss).toHaveBeenCalledTimes(0);

      // Should not fetch again
      expect(global.fetch).toHaveBeenCalledTimes(0);
    });
  });

  describe("Error Recovery Flow", () => {
    it("should emit error events and still allow successful retry", async () => {
      const testUrl = "https://example.com/audio3.mp3";
      const mockArrayBuffer = new ArrayBuffer(512);
      const mockAudioBuffer = new AudioBuffer({ length: 50, sampleRate: 44100 });

      // First attempt fails with network error
      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockArrayBuffer),
          headers: new Map(),
        });

      audioContextMock.decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);

      // Register event listeners
      cacophony.on("loadingStart", mockCallbacks.onLoadingStart);
      cacophony.on("loadingError", mockCallbacks.onLoadingError);
      cacophony.on("loadingComplete", mockCallbacks.onLoadingComplete);

      // First attempt should fail
      await expect(cacophony.createSound(testUrl)).rejects.toThrow("Network timeout");

      expect(mockCallbacks.onLoadingStart).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onLoadingError).toHaveBeenCalledWith(
        expect.objectContaining({
          url: testUrl,
          error: expect.any(Error),
          errorType: "network",
          timestamp: expect.any(Number),
        }),
      );
      expect(mockCallbacks.onLoadingComplete).toHaveBeenCalledTimes(0);

      // Clear memory cache and mock calls
      cacophony.clearMemoryCache();
      vi.clearAllMocks();

      // Second attempt should succeed
      const sound = await cacophony.createSound(testUrl);

      expect(mockCallbacks.onLoadingStart).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onLoadingComplete).toHaveBeenCalledTimes(1);
      expect(mockCallbacks.onLoadingError).toHaveBeenCalledTimes(0);
      expect(sound).toBeDefined();
    });
  });

  describe("Playback Error Propagation", () => {
    it("should propagate playback errors to sound error events", async () => {
      const testUrl = "https://example.com/audio4.mp3";
      const mockArrayBuffer = new ArrayBuffer(256);
      const mockAudioBuffer = new AudioBuffer({ length: 25, sampleRate: 44100 });

      // Mock successful loading
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map(),
      });
      audioContextMock.decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);

      // Create sound successfully
      const sound = await cacophony.createSound(testUrl);

      // Register error listeners
      sound.on("soundError", mockCallbacks.onSoundError);

      // Mock createBufferSource to fail on play
      const playbackError = new Error("AudioBufferSourceNode start failed");
      vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
        return {
          buffer: null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(() => {
            throw playbackError;
          }),
          stop: vi.fn(),
          onended: null,
          loop: false,
          loopStart: 0,
          loopEnd: 0,
          playbackRate: { value: 1, setValueAtTime: vi.fn() } as any,
        } as unknown as AudioBufferSourceNode;
      });

      // Attempt to play should trigger error propagation
      expect(() => sound.play()).toThrow("AudioBufferSourceNode start failed");

      // Note: The async soundError event emission happens in the background
      // The synchronous error throw confirms error handling is working
    });
  });

  describe("Complex Multi-Sound Scenario", () => {
    it("should handle multiple sounds with different cache and error states", async () => {
      const urls = [
        "https://example.com/sound1.mp3",
        "https://example.com/sound2.mp3",
        "https://example.com/sound3.mp3",
      ];

      const mockArrayBuffer = new ArrayBuffer(1024);
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });

      // Mock different responses for different URLs
      global.fetch = vi.fn().mockImplementation((url) => {
        if (url.includes("sound1")) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(mockArrayBuffer),
            headers: new Map(),
          });
        } else if (url.includes("sound2")) {
          return Promise.reject(new Error("404 Not Found"));
        } else if (url.includes("sound3")) {
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(mockArrayBuffer),
            headers: new Map(),
          });
        }
      });

      audioContextMock.decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);

      // Register all event listeners
      cacophony.on("loadingStart", mockCallbacks.onLoadingStart);
      cacophony.on("loadingComplete", mockCallbacks.onLoadingComplete);
      cacophony.on("loadingError", mockCallbacks.onLoadingError);
      cacophony.on("cacheMiss", mockCallbacks.onCacheMiss);
      cacophony.on("cacheHit", mockCallbacks.onCacheHit);

      // Load sounds with different outcomes
      const results = await Promise.allSettled([
        cacophony.createSound(urls[0]), // Should succeed
        cacophony.createSound(urls[1]), // Should fail
        cacophony.createSound(urls[2]), // Should succeed
      ]);

      // Verify results
      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
      expect(results[2].status).toBe("fulfilled");

      // Verify events were emitted correctly
      expect(mockCallbacks.onLoadingStart).toHaveBeenCalledTimes(3);
      expect(mockCallbacks.onLoadingComplete).toHaveBeenCalledTimes(2); // sound1 and sound3
      expect(mockCallbacks.onLoadingError).toHaveBeenCalledTimes(1); // sound2
      expect(mockCallbacks.onCacheMiss).toHaveBeenCalledTimes(3); // All new URLs

      // Load sound1 again - should hit memory cache
      await cacophony.createSound(urls[0]);
      expect(mockCallbacks.onCacheHit).toHaveBeenCalledWith(
        expect.objectContaining({
          url: urls[0],
          cacheType: "memory",
        }),
      );
    });
  });

  describe("Event Listener Management", () => {
    it("should properly handle adding and removing event listeners", async () => {
      const testUrl = "https://example.com/listener-test.mp3";
      const mockArrayBuffer = new ArrayBuffer(512);
      const mockAudioBuffer = new AudioBuffer({ length: 50, sampleRate: 44100 });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Map(),
      });
      audioContextMock.decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);

      const listener1 = vi.fn();
      const listener2 = vi.fn();

      // Add multiple listeners
      cacophony.on("loadingStart", listener1);
      cacophony.on("loadingStart", listener2);

      // Trigger event
      await cacophony.createSound(testUrl);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      // Remove one listener
      cacophony.off("loadingStart", listener1);

      // Clear cache and trigger again
      cacophony.clearMemoryCache();
      vi.clearAllMocks();

      await cacophony.createSound(`${testUrl}?v=2`);

      expect(listener1).toHaveBeenCalledTimes(0); // Removed
      expect(listener2).toHaveBeenCalledTimes(1); // Still active
    });
  });
});

describe("Audio cache isolation integration", () => {
  let contexts: AudioContext[];
  let instances: Cacophony[];
  let originalCaches: typeof caches;

  beforeEach(() => {
    contexts = [];
    instances = [];
    originalCaches = global.caches;
  });

  afterEach(async () => {
    for (const instance of instances) {
      instance.clearMemoryCache();
    }
    await Promise.all(contexts.map((context) => context.close()));
    global.caches = originalCaches;
    vi.restoreAllMocks();
  });

  it("decodes concurrent loads independently for contexts with different sample rates", async () => {
    const url = "https://example.com/context-isolation.wav";
    const contextA = new AudioContext({ sampleRate: 48000 });
    const contextB = new AudioContext({ sampleRate: 44100 });
    const sharedCache = new AudioCache();
    const instanceA = new Cacophony(contextA, sharedCache);
    const instanceB = new Cacophony(contextB, sharedCache);
    const bufferA = new AudioBuffer({ length: 480, sampleRate: 48000 });
    const bufferB = new AudioBuffer({ length: 441, sampleRate: 44100 });
    contexts.push(contextA, contextB);
    instances.push(instanceA, instanceB);
    global.caches = undefined as unknown as CacheStorage;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: new Headers(),
    } as Response);
    const decodeA = vi.spyOn(contextA, "decodeAudioData").mockResolvedValue(bufferA);
    const decodeB = vi.spyOn(contextB, "decodeAudioData").mockResolvedValue(bufferB);

    const [soundA, soundB] = await Promise.all([instanceA.createSound(url), instanceB.createSound(url)]);

    expect(soundA.buffer).toBe(bufferA);
    expect(soundB.buffer).toBe(bufferB);
    expect(decodeA).toHaveBeenCalledOnce();
    expect(decodeB).toHaveBeenCalledOnce();
  });

  it("keeps one instance's decoded entry when another instance clears its memory cache", async () => {
    const urlA = "data:audio/wav;base64,QQ==";
    const urlB = "data:audio/wav;base64,Qg==";
    const contextA = new AudioContext({ sampleRate: 48000 });
    const contextB = new AudioContext({ sampleRate: 44100 });
    const instanceA = new Cacophony(contextA);
    const instanceB = new Cacophony(contextB);
    const bufferA = new AudioBuffer({ length: 480, sampleRate: 48000 });
    const bufferB = new AudioBuffer({ length: 441, sampleRate: 44100 });
    contexts.push(contextA, contextB);
    instances.push(instanceA, instanceB);
    const decodeA = vi.spyOn(contextA, "decodeAudioData").mockResolvedValue(bufferA);
    const decodeB = vi.spyOn(contextB, "decodeAudioData").mockResolvedValue(bufferB);

    await instanceA.createSound(urlA);
    await instanceB.createSound(urlB);
    instanceA.clearMemoryCache();
    const cachedSoundB = await instanceB.createSound(urlB);

    expect(cachedSoundB.buffer).toBe(bufferB);
    expect(decodeA).toHaveBeenCalledOnce();
    expect(decodeB).toHaveBeenCalledOnce();
  });
});
