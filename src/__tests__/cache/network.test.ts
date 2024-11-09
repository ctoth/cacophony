import { vi, expect, describe, it, beforeEach } from "vitest";
import { AudioCache } from "../../cache";
import {
  createTestUrls,
  createTestAudioData,
  createMockAudioBuffer,
  mockResponses,
  simulateError,
  createCacheState,
  mockNetworkConditions
} from "../mockUtils";
import { audioContextMock } from "../../setupTests";

describe("AudioCache - Network Operations", () => {
  beforeEach(() => {
    AudioCache.clearMemoryCache();
    vi.clearAllMocks();
  });

  describe("Fetch Operations", () => {
    it("makes initial fetch request with correct headers", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      const cache = createCacheState.empty();
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      const fetchSpy = vi.fn().mockResolvedValue(
        mockResponses.success(arrayBuffer)
      );
      global.fetch = fetchSpy;

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);
      
      expect(fetchSpy).toHaveBeenCalledWith(url, expect.any(Object));
      const requestInit = fetchSpy.mock.calls[0][1];
      expect(requestInit.headers).toBeDefined();
    });

    it("handles 304 responses correctly", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      
      // Setup cache with existing data
      const cache = createCacheState.withEntry(
        url,
        arrayBuffer,
        { 
          url,
          etag: 'W/"123"',
          lastModified: new Date().toUTCString(),
          timestamp: Date.now()
        }
      );
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      // Mock 304 response
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.notModified()
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      const result = await AudioCache.getAudioBuffer(audioContextMock, url);
      expect(result).toBe(audioBuffer);
    });

    it("handles network errors gracefully", async () => {
      const url = createTestUrls.audio(1);
      
      const cache = createCacheState.empty();
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      simulateError.network();

      await expect(
        AudioCache.getAudioBuffer(audioContextMock, url)
      ).rejects.toThrow('Network error');
    });

    it("handles timeout errors", async () => {
      const url = createTestUrls.audio(1);
      
      const cache = createCacheState.empty();
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockImplementationOnce(mockNetworkConditions.timeout);

      await expect(
        AudioCache.getAudioBuffer(audioContextMock, url)
      ).rejects.toThrow('Network timeout');
    });
  });

  describe("Cache Headers", () => {
    it("sends correct cache headers when etag exists", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      const etag = 'W/"123"';
      
      // Setup cache with existing etag
      const cache = createCacheState.withEntry(
        url,
        arrayBuffer,
        { 
          url,
          etag,
          lastModified: new Date().toUTCString(),
          timestamp: Date.now() - (25 * 60 * 60 * 1000) // Make it 25 hours old to force revalidation
        }
      );
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      const fetchSpy = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer)
      );
      global.fetch = fetchSpy;

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);
      
      expect(fetchSpy).toHaveBeenCalled();
      const requestInit = fetchSpy.mock.calls[0][1];
      expect(requestInit.headers.get('If-None-Match')).toBe(etag);
    });

    it("updates stored headers after successful fetch", async () => {
      const url = createTestUrls.audio(1);
      const arrayBuffer = createTestAudioData.small();
      const audioBuffer = createMockAudioBuffer();
      const newEtag = 'W/"456"';
      
      const cache = createCacheState.empty();
      const cachePutSpy = vi.spyOn(cache, 'put');
      vi.spyOn(caches, 'open').mockResolvedValue(cache);
      
      global.fetch = vi.fn().mockResolvedValueOnce(
        mockResponses.success(arrayBuffer, { 'ETag': newEtag })
      );

      vi.spyOn(audioContextMock, "decodeAudioData")
        .mockResolvedValueOnce(audioBuffer);

      await AudioCache.getAudioBuffer(audioContextMock, url);
      
      // Verify metadata was stored with new ETag
      const metadataCall = cachePutSpy.mock.calls.find(
        call => call[0] === `${url}:meta`
      );
      expect(metadataCall).toBeDefined();
      const storedMetadata = await metadataCall[1].json();
      expect(storedMetadata.etag).toBe(newEtag);
    });
  });
});
