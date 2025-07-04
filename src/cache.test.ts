import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCache } from "./cache";
import { audioContextMock } from "./setupTests";

describe("AudioCache", () => {
  let cache: AudioCache;
  let mockFetch: typeof fetch;
  let mockCaches: typeof caches;

  beforeEach(() => {
    cache = new AudioCache();
    
    // Mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Mock Cache API
    mockCaches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      }),
    } as any;
    global.caches = mockCaches;
  });

  afterEach(() => {
    vi.clearAllMocks();
    cache.clearMemoryCache();
  });

  it("handles data URLs correctly", async () => {
    const dataUrl = "data:audio/wav;base64,SGVsbG8gV29ybGQ="; // "Hello World" in base64
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    
    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);
    
    const result = await cache.getAudioBuffer(audioContextMock, dataUrl);
    
    expect(result).toBe(mockAudioBuffer);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("caches decoded buffers in memory", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers(),
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    // First request should fetch
    const result1 = await cache.getAudioBuffer(audioContextMock, url);
    expect(result1).toBe(mockAudioBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second request should use memory cache
    const result2 = await cache.getAudioBuffer(audioContextMock, url);
    expect(result2).toBe(mockAudioBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Still just one fetch
  });

  it("handles 304 Not Modified responses correctly when cache expires", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"123456"';

    // Set a short cache expiration time for testing
    AudioCache.setCacheExpirationTime(100); // 100ms

    // Mock cache to return metadata with expired timestamp
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            etag,
            timestamp: Date.now() - 1000 // Expired timestamp
          })));
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    // Mock 304 response
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe(url);
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get('If-None-Match')).toBe(etag);
  });

  it("respects Cache-Control max-age for fresh content", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);

    // Mock cache to return fresh metadata with max-age
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            cacheControl: "public, max-age=3600", // 1 hour
            timestamp: Date.now() - 1000 // 1 second ago (fresh)
          })));
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    expect(mockFetch).not.toHaveBeenCalled(); // Should not fetch because content is fresh
  });

  it("fetches when Cache-Control max-age=0", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"123456"';

    // Mock cache to return metadata with max-age=0
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            etag,
            cacheControl: "public, max-age=0",
            timestamp: Date.now() - 1000
          })));
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    // Mock 304 response
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch because max-age=0
    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get('If-None-Match')).toBe(etag);
  });


  it("handles missing cache body with fresh metadata (fallback to network)", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);

    // Mock cache to return fresh metadata but no body
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            cacheControl: "public, max-age=3600", // Fresh for 1 hour
            timestamp: Date.now() - 1000 // 1 second ago (fresh)
          })));
        }
        // Return null for body - simulates missing cache body
        return Promise.resolve(null);
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    // Mock network response for fallback
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers({
        "Cache-Control": "public, max-age=3600",
        "ETag": '"fresh-version"'
      }),
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch as fallback
  });

  it("preserves Cache-Control on 304 responses", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"version-1"';
    const originalCacheControl = "public, max-age=3600";

    // Mock cache with existing metadata
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            etag,
            cacheControl: originalCacheControl,
            timestamp: Date.now() - 7200000 // 2 hours ago (stale)
          })));
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    // Mock 304 response with Cache-Control
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
      headers: new Headers({
        "Cache-Control": "public, max-age=7200", // Updated Cache-Control
      }),
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    
    // Verify Cache-Control was updated in metadata
    const updateMetadataCall = mockCache.put.mock.calls.find(call => 
      call[0].includes(':meta')
    );
    expect(updateMetadataCall).toBeDefined();
    const metadataResponse = updateMetadataCall[1];
    const updatedMetadata = JSON.parse(await metadataResponse.text());
    expect(updatedMetadata.cacheControl).toBe("public, max-age=7200");
  });

  it("handles cache expiration", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);

    // Set a short cache expiration time for testing
    AudioCache.setCacheExpirationTime(100); // 100ms

    // Mock cache with expired metadata
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            timestamp: Date.now() - 1000 // Expired timestamp
          })));
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers(),
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch due to expiration
  });

  it("handles concurrent requests for the same URL", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers(),
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValue(mockAudioBuffer);

    // Make multiple concurrent requests
    const requests = Promise.all([
      cache.getAudioBuffer(audioContextMock, url),
      cache.getAudioBuffer(audioContextMock, url),
      cache.getAudioBuffer(audioContextMock, url)
    ]);

    const results = await requests;
    
    expect(results).toHaveLength(3);
    results.forEach(result => expect(result).toBe(mockAudioBuffer));
    expect(mockFetch).toHaveBeenCalledTimes(1); // Should only fetch once
  });

  it("clears memory cache correctly", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers(),
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValue(mockAudioBuffer);

    // First request
    await cache.getAudioBuffer(audioContextMock, url);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Clear cache
    cache.clearMemoryCache();

    // Second request should fetch again
    await cache.getAudioBuffer(audioContextMock, url);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("makes conditional requests with ETag within TTL window", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"version-1"';
    const newEtag = '"version-2"';

    // Set a long cache expiration time to ensure we're within TTL
    AudioCache.setCacheExpirationTime(24 * 60 * 60 * 1000); // 24 hours

    // Mock cache with fresh metadata containing ETag
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            etag,
            timestamp: Date.now() - 1000 // Fresh timestamp (1 second ago)
          })));
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    // Mock server returning 200 with new ETag (content changed)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers({ 'ETag': newEtag }),
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // Verify conditional request was made with If-None-Match header
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe(url);
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get('If-None-Match')).toBe(etag);
  });

  it("makes conditional requests with Last-Modified within TTL window", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);
    const lastModified = 'Wed, 21 Oct 2015 07:28:00 GMT';

    // Set a long cache expiration time to ensure we're within TTL
    AudioCache.setCacheExpirationTime(24 * 60 * 60 * 1000); // 24 hours

    // Mock cache with fresh metadata containing Last-Modified
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            lastModified,
            timestamp: Date.now() - 1000 // Fresh timestamp (1 second ago)
          })));
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    // Mock server returning 200 (content changed)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
      arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      headers: new Headers({ 'Last-Modified': 'Thu, 22 Oct 2015 07:28:00 GMT' }),
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // Verify conditional request was made with If-Modified-Since header
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe(url);
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get('If-Modified-Since')).toBe(lastModified);
  });

  it("handles 304 Not Modified within TTL window correctly", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"unchanged-version"';

    // Set a long cache expiration time to ensure we're within TTL
    AudioCache.setCacheExpirationTime(24 * 60 * 60 * 1000); // 24 hours

    // Mock cache with fresh metadata and cached content
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            etag,
            timestamp: Date.now() - 1000 // Fresh timestamp (1 second ago)
          })));
        }
        // Return cached content
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    // Mock server returning 304 Not Modified
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // Verify metadata timestamp was updated on 304 response
    expect(mockCache.put).toHaveBeenCalledWith(
      `${url}:meta`,
      expect.any(Response)
    );
  });

  it("uses TTL fallback when no validation tokens exist", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);

    // Set a short cache expiration time for testing
    AudioCache.setCacheExpirationTime(100); // 100ms

    // Mock cache with metadata but no validation tokens and fresh timestamp
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            // No etag or lastModified
            timestamp: Date.now() - 50 // Fresh timestamp (50ms ago, within TTL)
          })));
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    // Should NOT fetch because TTL hasn't expired and no validation tokens
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("prioritizes validation tokens over TTL expiration", async () => {
    const url = "https://example.com/audio.mp3";
    const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const mockArrayBuffer = new ArrayBuffer(8);
    const etag = '"version-1"';

    // Set a very short cache expiration time
    AudioCache.setCacheExpirationTime(1); // 1ms

    // Mock cache with metadata containing ETag but expired timestamp
    const mockCache = {
      match: vi.fn().mockImplementation((key) => {
        if (key === `${url}:meta`) {
          return Promise.resolve(new Response(JSON.stringify({
            url,
            etag,
            timestamp: Date.now() - 1000 // Expired timestamp
          })));
        }
        return Promise.resolve(new Response(mockArrayBuffer));
      }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockCaches.open.mockResolvedValue(mockCache);

    // Mock server returning 304 Not Modified
    mockFetch.mockResolvedValueOnce({
      status: 304,
      ok: false,
    } as Response);

    vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

    const result = await cache.getAudioBuffer(audioContextMock, url);
    
    expect(result).toBe(mockAudioBuffer);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    
    // Verify conditional request was made even though TTL expired
    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1].headers as Headers;
    expect(headers.get('If-None-Match')).toBe(etag);
  });

  it("allows manual TTL configuration", () => {
    // Set custom TTL - should not throw
    expect(() => {
      AudioCache.setCacheExpirationTime(60 * 1000); // 1 minute
    }).not.toThrow();
    
    // Verify the method exists
    expect(AudioCache.setCacheExpirationTime).toBeDefined();
  });

  describe("Error handling", () => {
    it("handles 304 response with missing cached body (cache inconsistency)", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      const mockArrayBuffer = new ArrayBuffer(8);
      const etag = '"version-1"';
      const newEtag = '"version-2"';

      // Mock cache that returns metadata but no cached body (simulating corruption)
      const mockCache = {
        match: vi.fn().mockImplementation((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(new Response(JSON.stringify({
              url,
              etag,
              timestamp: Date.now() - 1000
            })));
          }
          // Return null for cached body (simulating missing/corrupted cache)
          return Promise.resolve(null);
        }),
        put: vi.fn(),
        delete: vi.fn(),
      };
      mockCaches.open.mockResolvedValue(mockCache);

      // Mock console.warn to verify warning is logged
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // First fetch returns 304 Not Modified
      // Second fetch (recovery) returns 200 with fresh content
      mockFetch
        .mockResolvedValueOnce({
          status: 304,
          ok: false,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
          arrayBuffer: () => Promise.resolve(mockArrayBuffer),
          headers: new Headers({ 'ETag': newEtag }),
        } as Response);

      vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

      const result = await cache.getAudioBuffer(audioContextMock, url);
      
      expect(result).toBe(mockAudioBuffer);
      expect(mockFetch).toHaveBeenCalledTimes(2); // First 304, then recovery fetch
      
      // Verify warning was logged
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cache inconsistency detected')
      );
      
      // Verify fresh content was cached
      expect(mockCache.put).toHaveBeenCalledWith(url, expect.any(Object));
      expect(mockCache.put).toHaveBeenCalledWith(`${url}:meta`, expect.any(Response));
      
      consoleWarnSpy.mockRestore();
    });

    it("handles malformed Cache-Control headers gracefully", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with malformed Cache-Control
      const mockCache = {
        match: vi.fn().mockImplementation((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(new Response(JSON.stringify({
              url,
              cacheControl: "invalid-directive", // Invalid Cache-Control
              timestamp: Date.now() - 1000
            })));
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: vi.fn(),
        delete: vi.fn(),
      };
      mockCaches.open.mockResolvedValue(mockCache);

      vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

      const result = await cache.getAudioBuffer(audioContextMock, url);
      
      expect(result).toBe(mockAudioBuffer);
      expect(mockFetch).not.toHaveBeenCalled(); // Should use cached content since max-age parse failed
    });

    it("handles concurrent requests with fresh cache correctly", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with fresh metadata
      const mockCache = {
        match: vi.fn().mockImplementation((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(new Response(JSON.stringify({
              url,
              cacheControl: "public, max-age=3600", // Fresh
              timestamp: Date.now() - 1000
            })));
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: vi.fn(),
        delete: vi.fn(),
      };
      mockCaches.open.mockResolvedValue(mockCache);

      vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValue(mockAudioBuffer);

      // Make concurrent requests
      const [result1, result2, result3] = await Promise.all([
        cache.getAudioBuffer(audioContextMock, url),
        cache.getAudioBuffer(audioContextMock, url),
        cache.getAudioBuffer(audioContextMock, url)
      ]);
      
      expect(result1).toBe(mockAudioBuffer);
      expect(result2).toBe(mockAudioBuffer);
      expect(result3).toBe(mockAudioBuffer);
      expect(mockFetch).not.toHaveBeenCalled(); // Should all use fresh cache
    });

    it("handles max-age=0 with missing validation headers", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with max-age=0 but no validation headers and no cached body
      const mockCache = {
        match: vi.fn().mockImplementation((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(new Response(JSON.stringify({
              url,
              cacheControl: "public, max-age=0", // Always stale
              // No etag or lastModified
              timestamp: Date.now() - 1000
            })));
          }
          return Promise.resolve(null); // No cached body, forcing network
        }),
        put: vi.fn(),
        delete: vi.fn(),
      };
      mockCaches.open.mockResolvedValue(mockCache);

      // Mock unconditional fetch (no validation headers)
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Headers(),
      } as Response);

      vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

      const result = await cache.getAudioBuffer(audioContextMock, url);
      
      expect(result).toBe(mockAudioBuffer);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.get('If-None-Match')).toBeNull();
      expect(headers.get('If-Modified-Since')).toBeNull();
    });

    it("falls back to TTL when Cache-Control is missing", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Set TTL for testing
      AudioCache.setCacheExpirationTime(1000); // 1 second

      // Mock cache without Cache-Control but with fresh TTL
      const mockCache = {
        match: vi.fn().mockImplementation((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(new Response(JSON.stringify({
              url,
              // No cacheControl field
              timestamp: Date.now() - 500 // 0.5 seconds ago (fresh by TTL)
            })));
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: vi.fn(),
        delete: vi.fn(),
      };
      mockCaches.open.mockResolvedValue(mockCache);

      vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

      const result = await cache.getAudioBuffer(audioContextMock, url);
      
      expect(result).toBe(mockAudioBuffer);
      expect(mockFetch).not.toHaveBeenCalled(); // Should use cache due to fresh TTL
    });

    it("respects no-cache directive regardless of freshness", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      const mockArrayBuffer = new ArrayBuffer(8);
      const etag = '"version-1"';

      // Mock cache with no-cache directive but fresh timestamp
      const mockCache = {
        match: vi.fn().mockImplementation((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(new Response(JSON.stringify({
              url,
              etag,
              cacheControl: "public, max-age=3600, no-cache", // Fresh but no-cache
              timestamp: Date.now() - 1000 // 1 second ago (would be fresh)
            })));
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: vi.fn(),
        delete: vi.fn(),
      };
      mockCaches.open.mockResolvedValue(mockCache);

      // Mock 304 response
      mockFetch.mockResolvedValueOnce({
        status: 304,
        ok: false,
        headers: new Headers(),
      } as Response);

      vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

      const result = await cache.getAudioBuffer(audioContextMock, url);
      
      expect(result).toBe(mockAudioBuffer);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch due to no-cache directive
      const fetchCall = mockFetch.mock.calls[0];
      const headers = fetchCall[1].headers as Headers;
      expect(headers.get('If-None-Match')).toBe(etag);
    });

    it("respects must-revalidate directive", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with must-revalidate directive
      const mockCache = {
        match: vi.fn().mockImplementation((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(new Response(JSON.stringify({
              url,
              cacheControl: "public, max-age=3600, must-revalidate", // Fresh but must revalidate
              timestamp: Date.now() - 1000 // 1 second ago (would be fresh)
            })));
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: vi.fn(),
        delete: vi.fn(),
      };
      mockCaches.open.mockResolvedValue(mockCache);

      // Mock 200 response (no validation headers available)
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        clone: () => ({ arrayBuffer: () => Promise.resolve(mockArrayBuffer) }),
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: new Headers(),
      } as Response);

      vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

      const result = await cache.getAudioBuffer(audioContextMock, url);
      
      expect(result).toBe(mockAudioBuffer);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Should fetch due to must-revalidate directive
    });

    it("handles improved max-age parsing with quotes and whitespace", async () => {
      const url = "https://example.com/audio.mp3";
      const mockAudioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      const mockArrayBuffer = new ArrayBuffer(8);

      // Mock cache with quoted max-age and whitespace
      const mockCache = {
        match: vi.fn().mockImplementation((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(new Response(JSON.stringify({
              url,
              cacheControl: 'public, max-age = "3600"', // Quoted with whitespace
              timestamp: Date.now() - 1000 // 1 second ago (fresh)
            })));
          }
          return Promise.resolve(new Response(mockArrayBuffer));
        }),
        put: vi.fn(),
        delete: vi.fn(),
      };
      mockCaches.open.mockResolvedValue(mockCache);

      vi.spyOn(audioContextMock, "decodeAudioData").mockResolvedValueOnce(mockAudioBuffer);

      const result = await cache.getAudioBuffer(audioContextMock, url);
      
      expect(result).toBe(mockAudioBuffer);
      expect(mockFetch).not.toHaveBeenCalled(); // Should not fetch because content is fresh
    });

    it("throws error when recovery fetch fails after cache inconsistency", async () => {
      const url = "https://example.com/audio.mp3";
      const etag = '"version-1"';

      // Mock cache with metadata but no cached body
      const mockCache = {
        match: vi.fn().mockImplementation((key) => {
          if (key === `${url}:meta`) {
            return Promise.resolve(new Response(JSON.stringify({
              url,
              etag,
              timestamp: Date.now() - 1000
            })));
          }
          return Promise.resolve(null);
        }),
        put: vi.fn(),
        delete: vi.fn(),
      };
      mockCaches.open.mockResolvedValue(mockCache);

      // Mock console.warn
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // First fetch returns 304, recovery fetch fails
      mockFetch
        .mockResolvedValueOnce({
          status: 304,
          ok: false,
        } as Response)
        .mockResolvedValueOnce({
          status: 500,
          statusText: 'Internal Server Error',
          ok: false,
        } as Response);

      await expect(cache.getAudioBuffer(audioContextMock, url)).rejects.toThrow(
        'Failed to fetch resource after cache inconsistency: 500 Internal Server Error'
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
