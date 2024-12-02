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
});
