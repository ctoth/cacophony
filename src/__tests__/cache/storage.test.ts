import { vi, expect, describe, it, beforeEach } from "vitest";
import { AudioCache } from "../../cache";
import {
  createTestUrls,
  createTestAudioData,
  createMockAudioBuffer,
  mockResponses,
  simulateError,
  createCacheState
} from "../mockUtils";
import { audioContextMock } from "../../setupTests";

describe("AudioCache - Cache Storage", () => {
  beforeEach(() => {
    AudioCache.clearMemoryCache();
    vi.clearAllMocks();
  });

  describe("Cache API Integration", () => {
    it("stores response and metadata separately", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      const cache = createCacheState.empty();
      const cachePutSpy = vi.spyOn(cache, 'put');
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer)
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);
      
      // Verify both data and metadata were stored
      expect(cachePutSpy).toHaveBeenCalledTimes(2);
      const dataPut = cachePutSpy.mock.calls.find(call => call[0] === url);
      const metaPut = cachePutSpy.mock.calls.find(call => call[0] === `${url}:meta`);
      
      expect(dataPut).toBeDefined();
      expect(metaPut).toBeDefined();
      
      // Verify metadata structure
      const metadata = await metaPut[1].json();
      expect(metadata).toEqual(expect.objectContaining({
        url: url,
        etag: expect.any(String),
        timestamp: expect.any(Number)
      }));
    });

    it("handles missing Cache API", async () => {
      const url = createTestUrls.audio(1);
      
      // Simulate Cache API not available
      const originalCaches = global.caches;
      global.caches = undefined;
      
      await expect(
        AudioCache.getAudioBuffer(audioContextMock, url)
      ).rejects.toThrow("Cache API is not supported");
      
      // Restore Cache API
      global.caches = originalCaches;
    });

    it("handles storage errors", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      // Setup cache with storage error
      const cache = simulateError.storage();
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer)
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      // Should still return audio buffer even if caching fails
      const result = await AudioCache.getAudioBuffer(audioContextMock, url);
      expect(result).toBe(audioBuffer);
    });

    it("cleans up partial entries", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      const cache = createCacheState.empty();
      const cacheDeleteSpy = vi.spyOn(cache, 'delete');
      vi.spyOn(cache, 'put').mockRejectedValueOnce(new Error("Storage failed"));
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer)
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);
      
      // Should attempt to clean up both entries
      expect(cacheDeleteSpy).toHaveBeenCalledWith(url);
      expect(cacheDeleteSpy).toHaveBeenCalledWith(`${url}:meta`);
    });

    it("validates stored data", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      // Setup cache with corrupted data
      const cache = createCacheState.corrupted(url);
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer)
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      const result = await AudioCache.getAudioBuffer(audioContextMock, url);
      
      // Should fetch fresh data when cache is corrupted
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result).toBe(audioBuffer);
    });
  });

  describe("Metadata Management", () => {
    it("stores complete metadata", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      const etag = 'W/"123"';
      const lastModified = new Date().toUTCString();
      
      const cache = createCacheState.empty();
      const cachePutSpy = vi.spyOn(cache, 'put');
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer, {
          'ETag': etag,
          'Last-Modified': lastModified
        })
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);
      
      const metaPut = cachePutSpy.mock.calls.find(call => call[0] === `${url}:meta`);
      expect(metaPut).toBeDefined();
      const metadata = await metaPut[1].json();
      expect(metadata).toEqual({
        url,
        etag,
        lastModified,
        timestamp: expect.any(Number)
      });
    });

    it("updates timestamps", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      const originalTimestamp = Date.now() - 1000;
      
      // Create a working mock cache with a Map to actually store stuff
      const storedData = new Map();
      const cache = {
        match: vi.fn(key => Promise.resolve(storedData.get(key))),
        put: vi.fn((key, value) => {
          storedData.set(key, value);
          return Promise.resolve();
        }),
        delete: vi.fn()
      };

      // Set up initial cache state
      const initialMetadata = {
        url,
        etag: 'W/"123"',
        lastModified: new Date().toUTCString(),
        timestamp: originalTimestamp
      };

      // Store initial data in our mock cache
      await cache.put(url, mockResponses.success(arrayBuffer));
      await cache.put(
        `${url}:meta`,
        new Response(JSON.stringify(initialMetadata), {
          headers: { "Content-Type": "application/json" }
        })
      );

      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      // Mock 304 response to trigger timestamp update
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.notModified({
          'Date': new Date().toUTCString()
        })
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);

      // Get the updated metadata
      const metaResponse = await cache.match(`${url}:meta`);
      const updatedMetadata = await metaResponse.json();

      // Verify timestamp was updated
      expect(updatedMetadata.timestamp).toBeGreaterThan(originalTimestamp);
    });

    it("handles missing metadata", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      // Setup cache with data but no metadata
      const cache = createCacheState.empty();
      vi.spyOn(cache, 'match').mockImplementation((key: string) => {
        if (key === url) {
          return Promise.resolve(mockResponses.success(arrayBuffer));
        }
        return Promise.resolve(undefined);
      });
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer)
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);
      
      // Should trigger a new fetch since metadata is missing
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("validates metadata structure", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      // Setup cache with invalid metadata
      const cache = createCacheState.empty();
      vi.spyOn(cache, 'match').mockImplementation((key: string) => {
        if (key === url) {
          return Promise.resolve(mockResponses.success(arrayBuffer));
        }
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({ 
            invalid: "metadata"
          })));
        }
        return Promise.resolve(undefined);
      });
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer)
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);
      
      // Should fetch fresh data when metadata is invalid
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("cleans up invalid metadata", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      const cache = createCacheState.empty();
      const cacheDeleteSpy = vi.spyOn(cache, 'delete');
      vi.spyOn(cache, 'match').mockImplementation((key: string) => {
        if (key === url) {
          return Promise.resolve(mockResponses.success(arrayBuffer));
        }
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response("invalid json"));
        }
        return Promise.resolve(undefined);
      });
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer)
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);
      
      // Should clean up both entries when metadata is invalid
      expect(cacheDeleteSpy).toHaveBeenCalledWith(url);
      expect(cacheDeleteSpy).toHaveBeenCalledWith(`${url}:meta`);
    });
  });
});
