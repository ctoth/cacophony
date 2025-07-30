import { AudioContext, AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStream } from "./stream";

describe("Stream operations with AbortController", () => {
  let audioContextMock: AudioContext;
  let mockFetch: any;
  let mockReader: any;
  let mockResponse: any;
  let consoleSpy: any;

  beforeEach(() => {
    audioContextMock = new AudioContext();
    
    // Mock console to avoid test output noise
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock fetch and response body reader
    mockReader = {
      read: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    
    mockResponse = {
      ok: true,
      status: 200,
      body: {
        getReader: vi.fn().mockReturnValue(mockReader),
        cancel: vi.fn(),
      },
    };
    
    mockFetch = vi.fn().mockResolvedValue(mockResponse);
    global.fetch = mockFetch;
    
    // Mock decodeAudioData to prevent infinite recursion
    audioContextMock.decodeAudioData = vi.fn().mockImplementation((buffer, success) => {
      // Create a minimal buffer and call success immediately
      const mockBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      setTimeout(() => success(mockBuffer), 0);
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    consoleSpy.mockRestore();
    audioContextMock.close();
  });

  it("should pass AbortSignal to fetch request", () => {
    const controller = new AbortController();
    
    // Mock simple completion to avoid infinite loop
    mockReader.read.mockResolvedValue({ value: undefined, done: true });

    createStream("https://example.com/audio.wav", audioContextMock, controller.signal);

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/audio.wav", { signal: controller.signal });
  });

  it("should work without AbortSignal (backward compatibility)", () => {
    // Mock simple completion to avoid infinite loop
    mockReader.read.mockResolvedValue({ value: undefined, done: true });

    createStream("https://example.com/audio.wav", audioContextMock);

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/audio.wav", undefined);
  });

  it("should return early when signal is already aborted", () => {
    const controller = new AbortController();
    controller.abort();

    createStream("https://example.com/audio.wav", audioContextMock, controller.signal);

    // Should not call fetch when already aborted
    expect(mockFetch).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(DOMException));
  });

  it("should handle fetch rejection gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    createStream("https://example.com/audio.wav", audioContextMock);

    // Wait for promise rejection to be handled
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(Error));
  });

  it("should handle HTTP errors", async () => {
    mockResponse.ok = false;
    mockResponse.status = 404;

    createStream("https://example.com/audio.wav", audioContextMock);

    // Wait for promise rejection to be handled
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(Error));
  });

  it("should handle missing response body", async () => {
    mockResponse.body = null;

    createStream("https://example.com/audio.wav", audioContextMock);

    // Wait for promise rejection to be handled
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(Error));
  });

  it("should setup reader and abort listener", async () => {
    const controller = new AbortController();
    mockReader.read.mockResolvedValue({ value: undefined, done: true });

    createStream("https://example.com/audio.wav", audioContextMock, controller.signal);

    // Wait for fetch to resolve
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockResponse.body.getReader).toHaveBeenCalled();
  });
});