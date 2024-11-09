import { vi, expect, describe, it, beforeEach } from "vitest";
import { AudioCache } from "../../cache";
import { 
  createTestUrls,
  createTestAudioData,
  createMockAudioBuffer,
  createCacheState,
  mockResponses,
  simulateError
} from "../mockUtils";
import { audioContextMock } from "../../setupTests";

describe("AudioCache - Basic Operations", () => {
  beforeEach(() => {
    AudioCache.clearMemoryCache();
    vi.clearAllMocks();
  });

  describe("LRU Cache Implementation", () => {
    it("should store and retrieve decoded buffers", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      // Setup cache miss scenario
      const cache = createCacheState.empty();
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      // Mock successful fetch
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer)
      );

      // Mock successful decode
      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      // First request should fetch and decode
      const result1 = await AudioCache.getAudioBuffer(audioContextMock, url);
      expect(result1).toBe(audioBuffer);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(audioContextMock.decodeAudioData).toHaveBeenCalledTimes(1);
      expect(cache.put).toHaveBeenCalledTimes(2); // One for data, one for metadata

      // Second request should use cached buffer
      const result2 = await AudioCache.getAudioBuffer(audioContextMock, url);
      expect(result2).toBe(audioBuffer);
      expect(fetch).toHaveBeenCalledTimes(1); // No additional fetch
      expect(audioContextMock.decodeAudioData).toHaveBeenCalledTimes(1); // No additional decode
    });

    it("should evict least recently used items when cache is full", async () => {
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      // Setup cache
      const cache = createCacheState.empty();
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      // Mock fetch and decode for all requests
      global.fetch = vi.fn().mockImplementation(() => 
        Promise.resolve(mockResponses.success(arrayBuffer))
      );
      
      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockImplementation(() => Promise.resolve(audioBuffer));

      // Fill cache to its limit (DEFAULT_CACHE_SIZE = 100)
      const urls = Array.from(
        { length: 101 }, 
        (_, i) => createTestUrls.audio(i)
      );
      
      // Load all URLs
      await Promise.all(urls.map(url => 
        AudioCache.getAudioBuffer(audioContextMock, url)
      ));

      // Reset mocks to verify new fetch
      vi.clearAllMocks();
      
      // Request the first URL again - should have been evicted
      await AudioCache.getAudioBuffer(audioContextMock, urls[0]);
      
      // Should need to fetch and decode again
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(audioContextMock.decodeAudioData).toHaveBeenCalledTimes(1);
    });

    it("should handle cache initialization errors", async () => {
      const url = createTestUrls.audio(1);
      
      // Simulate Cache API not available
      global.caches = undefined;
      
      await expect(
        AudioCache.getAudioBuffer(audioContextMock, url)
      ).rejects.toThrow("Cache API is not supported");
      
      // Restore Cache API
      Object.defineProperty(global, 'caches', { 
        value: { open: vi.fn().mockResolvedValue(createCacheState.empty()) }
      });
    });
  });
});
