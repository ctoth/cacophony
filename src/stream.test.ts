import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
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
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const _consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

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
      return Promise.resolve(mockBuffer);
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

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/audio.wav", {
      signal: controller.signal,
    });
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
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(Error));
  });

  it("should handle HTTP errors", async () => {
    mockResponse.ok = false;
    mockResponse.status = 404;

    createStream("https://example.com/audio.wav", audioContextMock);

    // Wait for promise rejection to be handled
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(Error));
  });

  it("should handle missing response body", async () => {
    mockResponse.body = null;

    createStream("https://example.com/audio.wav", audioContextMock);

    // Wait for promise rejection to be handled
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith("Stream error:", expect.any(Error));
  });

  it("should setup reader and abort listener", async () => {
    const controller = new AbortController();
    mockReader.read.mockResolvedValue({ value: undefined, done: true });

    createStream("https://example.com/audio.wav", audioContextMock, controller.signal);

    // Wait for fetch to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockResponse.body.getReader).toHaveBeenCalled();
  });

  it("routes decoded BufferSource through outputNode (not context.destination) when outputNode is provided", async () => {
    // Regression test for routing bug: stream.ts previously connected the
    // decoded BufferSource directly to context.destination, bypassing the
    // library's globalGainNode. Now the function accepts an optional
    // outputNode so callers can route streamed audio through their shared
    // gain node. See notes/scout-routing-graph.md.
    const sourceConnectSpy = vi.fn();
    const originalCreateBufferSource = audioContextMock.createBufferSource.bind(audioContextMock);
    vi.spyOn(audioContextMock, "createBufferSource").mockImplementation(() => {
      const realSource = originalCreateBufferSource();
      const wrapped = new Proxy(realSource, {
        get(target, prop, receiver) {
          if (prop === "connect") {
            return (...args: any[]) => {
              sourceConnectSpy(...args);
              return (target as any).connect(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value, receiver) {
          return Reflect.set(target, prop, value, receiver);
        },
      });
      return wrapped as any;
    });

    const outputNode = audioContextMock.createGain();
    const chunk = new Uint8Array(48);
    chunk.set([82, 73, 70, 70], 0);
    chunk.set([87, 65, 86, 69], 8);

    mockReader.read
      .mockResolvedValueOnce({ value: chunk, done: false })
      .mockResolvedValueOnce({ value: undefined, done: true });

    createStream("https://example.com/audio.wav", audioContextMock, undefined, outputNode);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sourceConnectSpy).toHaveBeenCalled();
    // Every call must target outputNode, never the raw context.destination.
    for (const call of sourceConnectSpy.mock.calls) {
      expect(call[0]).toBe(outputNode);
      expect(call[0]).not.toBe(audioContextMock.destination);
    }
  });

  it("should prepend the WAV header when decoding chunks after the first", async () => {
    const firstChunk = new Uint8Array(48);
    firstChunk.set([82, 73, 70, 70], 0);
    firstChunk.set([87, 65, 86, 69], 8);
    firstChunk.set([11, 12, 13, 14], 44);
    const secondChunk = new Uint8Array([21, 22, 23, 24]);
    const decodedBuffers: ArrayBuffer[] = [];

    audioContextMock.decodeAudioData = vi.fn().mockImplementation((buffer, success) => {
      decodedBuffers.push(buffer);
      const mockBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      setTimeout(() => success(mockBuffer), 0);
      return Promise.resolve(mockBuffer);
    });
    mockReader.read
      .mockResolvedValueOnce({ value: firstChunk, done: false })
      .mockResolvedValueOnce({ value: secondChunk, done: false })
      .mockResolvedValueOnce({ value: undefined, done: true });

    createStream("https://example.com/audio.wav", audioContextMock);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(audioContextMock.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(new Uint8Array(decodedBuffers[0])).toEqual(firstChunk);
    expect(new Uint8Array(decodedBuffers[1]).slice(0, 44)).toEqual(firstChunk.slice(0, 44));
    expect(new Uint8Array(decodedBuffers[1]).slice(44)).toEqual(secondChunk);
  });
});
