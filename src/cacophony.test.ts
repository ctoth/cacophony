import { AudioBuffer } from "standardized-audio-context-mock";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
  vi,
} from "vitest";

// Mock standardized-audio-context to provide a mockable AudioWorkletNode
vi.mock("standardized-audio-context", async () => {
  const actual = await vi.importActual("standardized-audio-context");
  return {
    ...actual,
    AudioWorkletNode: vi.fn(),
  };
});

import { AudioWorkletNode } from "standardized-audio-context";
import { SoundType } from "./cacophony";
import { Group } from "./group";
import { audioContextMock, cacophony, mockCache } from "./setupTests";
import { Sound } from "./sound";

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

describe("Cacophony core", () => {
  test("Cacophony is created with the correct context", () => {
    expect(cacophony.context).toBe(audioContextMock);
  });

  test("that createSound creates a sound with the correct buffer", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = await cacophony.createSound(buffer);
    expect(sound.buffer).toBe(buffer);
  });

  test("that createSound creates a sound with the correct context", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound = await cacophony.createSound(buffer);
    expect(sound.context).toBe(audioContextMock);
  });

  it("createOscillator creates an oscillator with default parameters when none are provided", () => {
    const synth = cacophony.createOscillator({});
    expect(synth.type).toBe("sine");
    expect(synth.frequency).toBe(440);
  });

  it("createOscillator creates an oscillator with the provided parameters", () => {
    const synth = cacophony.createOscillator({
      frequency: 880,
      type: "square",
    });
    expect(synth.type).toBe("square");
    expect(synth.frequency).toBe(880);
  });

  it("createGroup creates a Group instance with the provided Sound instances", async () => {
    const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    const sound1 = await cacophony.createSound(buffer);
    const sound2 = await cacophony.createSound(buffer);
    const group = await cacophony.createGroup([sound1, sound2]);
    expect(group.sounds.length).toBe(2);
    expect(group.sounds[0]).toBe(sound1);
    expect(group.sounds[1]).toBe(sound2);
  });

  it("createBiquadFilter creates a BiquadFilterNode with default parameters when none are provided", () => {
    const filter = cacophony.createBiquadFilter({});
    expect(filter.type).toBe("lowpass");
    expect(filter.frequency.value).toBe(350);
    expect(filter.gain.value).toBe(0);
    expect(filter.Q.value).toBe(1);
  });

  it("createBiquadFilter creates a BiquadFilterNode with the provided parameters", () => {
    const filter = cacophony.createBiquadFilter({
      type: "highpass",
      frequency: 5000,
      gain: 5,
      Q: 0.5,
    });
    expect(filter.type).toBe("highpass");
    expect(filter.frequency.value).toBe(5000);
    expect(filter.gain.value).toBe(5);
    expect(filter.Q.value).toBe(0.5);
  });

  describe("Global volume and muting", () => {
    it("sets and gets global volume correctly", () => {
      cacophony.volume = 0.5;
      expect(cacophony.volume).toBe(0.5);
      expect(cacophony.globalGainNode.gain.value).toBe(0.5);

      cacophony.volume = 0.75;
      expect(cacophony.volume).toBe(0.75);
      expect(cacophony.globalGainNode.gain.value).toBe(0.75);
    });

    it("mutes and unmutes correctly", () => {
      cacophony.volume = 0.8;
      expect(cacophony.muted).toBe(false);

      cacophony.mute();
      expect(cacophony.muted).toBe(true);
      expect(cacophony.volume).toBe(0);
      expect(cacophony.globalGainNode.gain.value).toBe(0);

      cacophony.unmute();
      expect(cacophony.muted).toBe(false);
      expect(cacophony.volume).toBe(0.8);
      expect(cacophony.globalGainNode.gain.value).toBe(0.8);
    });

    it("handles muted property correctly", () => {
      cacophony.volume = 0.6;

      cacophony.muted = true;
      expect(cacophony.muted).toBe(true);
      expect(cacophony.volume).toBe(0);
      expect(cacophony.globalGainNode.gain.value).toBe(0);

      cacophony.muted = false;
      expect(cacophony.muted).toBe(false);
      expect(cacophony.volume).toBe(0.6);
      expect(cacophony.globalGainNode.gain.value).toBe(0.6);
    });
  });
});

describe("Cacophony advanced features", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createStream creates a streaming Sound instance", async () => {
    const streamSound = await cacophony.createStream(
      "https://example.com/audio.mp3"
    );
    expect(streamSound).toBeInstanceOf(Sound);
    expect(streamSound.soundType).toBe(SoundType.Streaming);
  });

  it("createGroupFromUrls creates a Group with Sound instances", async () => {
    const urls = ["url1", "url2", "url3"];
    const mockBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
    vi.mocked(mockCache.getAudioBuffer).mockResolvedValue(mockBuffer);
    const group = await cacophony.createGroupFromUrls(urls);
    expect(group).toBeInstanceOf(Group);
    expect(group.sounds.length).toBe(3);
    group.sounds.forEach((sound) => expect(sound).toBeInstanceOf(Sound));
  });

  it("clearMemoryCache calls cache.clearMemoryCache", () => {
    cacophony.clearMemoryCache();
    expect(mockCache.clearMemoryCache).toHaveBeenCalled();
  });

  it("sets and gets listener orientation correctly", () => {
    const orientation = {
      forward: [1, 0, 0],
      up: [0, 1, 0],
    };
    // Mock the listener properties
    cacophony.listener = {
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: 0 },
      upX: { value: 0 },
      upY: { value: 0 },
      upZ: { value: 0 },
    } as any;
    cacophony.listenerOrientation = orientation;
    expect(cacophony.listenerOrientation).toEqual(orientation);
  });

  it("throws an error when creating a sound with an invalid URL", async () => {
    vi.mocked(mockCache.getAudioBuffer).mockRejectedValueOnce(
      new Error("Invalid URL")
    );
    await expect(cacophony.createSound("invalid-url")).rejects.toThrow(
      "Invalid URL"
    );
  });

  it("pause and resume methods call context.suspend and context.resume", () => {
    const suspendSpy = vi.spyOn(cacophony.context, "suspend");
    const resumeSpy = vi.spyOn(cacophony.context, "resume");

    cacophony.pause();
    expect(suspendSpy).toHaveBeenCalled();

    cacophony.resume();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it("setGlobalVolume sets the global gain node value", () => {
    cacophony.setGlobalVolume(0.5);
    expect(cacophony.globalGainNode.gain.value).toBe(0.5);
  });

  describe("AbortSignal support", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("createSound with buffer ignores AbortSignal (immediate resolution)", async () => {
      const buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      const controller = new AbortController();
      
      // Should work even with aborted signal since it's immediate
      controller.abort();
      
      const sound = await cacophony.createSound(buffer, SoundType.Buffer, 'HRTF', controller.signal);
      expect(sound.buffer).toBe(buffer);
      expect(sound.soundType).toBe(SoundType.Buffer);
    });

    it("createSound with URL passes AbortSignal to cache", async () => {
      const url = "https://example.com/audio.mp3";
      const controller = new AbortController();
      const mockBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });

      // Mock the cache to verify signal is passed through
      const getAudioBufferSpy = vi.spyOn(mockCache, 'getAudioBuffer')
        .mockResolvedValueOnce(mockBuffer);

      const sound = await cacophony.createSound(url, SoundType.Buffer, 'HRTF', controller.signal);

      expect(getAudioBufferSpy).toHaveBeenCalledWith(
        audioContextMock,
        url,
        controller.signal,
        expect.any(Object) // Event callbacks
      );
      expect(sound.buffer).toBe(mockBuffer);
      expect(sound.url).toBe(url);
    });

    it("createSound with URL throws AbortError when signal is aborted", async () => {
      const url = "https://example.com/audio.mp3";
      const controller = new AbortController();

      // Mock the cache to throw AbortError
      vi.spyOn(mockCache, 'getAudioBuffer')
        .mockRejectedValueOnce(new DOMException("Operation was aborted", "AbortError"));

      controller.abort();

      await expect(
        cacophony.createSound(url, SoundType.Buffer, 'HRTF', controller.signal)
      ).rejects.toMatchObject({
        name: "AbortError",
        message: "Operation was aborted"
      });
    });

    it("createSound works without AbortSignal (backward compatibility)", async () => {
      const url = "https://example.com/audio.mp3";
      const mockBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });

      const getAudioBufferSpy = vi.spyOn(mockCache, 'getAudioBuffer')
        .mockResolvedValueOnce(mockBuffer);

      const sound = await cacophony.createSound(url, SoundType.Buffer);

      expect(getAudioBufferSpy).toHaveBeenCalledWith(
        audioContextMock,
        url,
        undefined, // No signal should be passed
        expect.any(Object) // Event callbacks
      );
      expect(sound.buffer).toBe(mockBuffer);
    });

    it("createSound with different SoundTypes handles AbortSignal correctly", async () => {
      const url = "https://example.com/audio.mp3";
      const controller = new AbortController();

      // Test HTML sound type - should not call cache at all
      const htmlSound = await cacophony.createSound(url, SoundType.HTML, 'HRTF', controller.signal);
      expect(htmlSound.soundType).toBe(SoundType.HTML);
      expect(htmlSound.url).toBe(url);

      // Test streaming sound type - cache should not be called
      const streamSound = await cacophony.createSound(url, SoundType.Streaming, 'HRTF', controller.signal);
      expect(streamSound.soundType).toBe(SoundType.Streaming);
      expect(streamSound.url).toBe(url);

      // Verify cache was not called for HTML or Streaming types
      expect(mockCache.getAudioBuffer).not.toHaveBeenCalled();
    });

    it("createGroupFromUrls passes AbortSignal to all createSound calls", async () => {
      const urls = ["audio1.mp3", "audio2.mp3", "audio3.mp3"];
      const controller = new AbortController();
      const mockBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });

      // Mock cache to return buffer for all calls
      vi.spyOn(mockCache, 'getAudioBuffer')
        .mockResolvedValue(mockBuffer);

      const group = await cacophony.createGroupFromUrls(urls, SoundType.Buffer, 'HRTF', controller.signal);

      expect(group).toBeInstanceOf(Group);
      expect(group.sounds.length).toBe(3);

      // Verify cache was called with signal for each URL
      expect(mockCache.getAudioBuffer).toHaveBeenCalledTimes(3);
      urls.forEach(url => {
        expect(mockCache.getAudioBuffer).toHaveBeenCalledWith(
          audioContextMock,
          url,
          controller.signal,
          expect.any(Object) // Event callbacks
        );
      });
    });

    it("createGroupFromUrls fails completely when AbortSignal is aborted", async () => {
      const urls = ["audio1.mp3", "audio2.mp3"];
      const controller = new AbortController();

      // Mock cache to throw AbortError
      vi.spyOn(mockCache, 'getAudioBuffer')
        .mockRejectedValue(new DOMException("Operation was aborted", "AbortError"));

      controller.abort();

      await expect(
        cacophony.createGroupFromUrls(urls, SoundType.Buffer, 'HRTF', controller.signal)
      ).rejects.toMatchObject({
        name: "AbortError"
      });
    });

    it("createGroupFromUrls works without AbortSignal (backward compatibility)", async () => {
      const urls = ["audio1.mp3", "audio2.mp3"];
      const mockBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });

      vi.spyOn(mockCache, 'getAudioBuffer')
        .mockResolvedValue(mockBuffer);

      const group = await cacophony.createGroupFromUrls(urls);

      expect(group.sounds.length).toBe(2);
      expect(mockCache.getAudioBuffer).toHaveBeenCalledTimes(2);
      
      // Verify no signal was passed
      urls.forEach(url => {
        expect(mockCache.getAudioBuffer).toHaveBeenCalledWith(
          audioContextMock,
          url,
          undefined,
          expect.any(Object) // Event callbacks
        );
      });
    });
  });

  describe("Worklet operations with AbortSignal", () => {
    let mockAudioWorklet: any;

    beforeEach(() => {
      vi.clearAllMocks();
      
      // Mock AudioWorklet
      mockAudioWorklet = {
        addModule: vi.fn().mockResolvedValue(undefined)
      };
      
      // Mock the audioWorklet property with defineProperty since it's read-only
      Object.defineProperty(audioContextMock, 'audioWorklet', {
        value: mockAudioWorklet,
        writable: true,
        configurable: true,
      });
    });

    it("loadWorklets passes AbortSignal to createWorkletNode", async () => {
      const controller = new AbortController();
      const createWorkletSpy = vi.spyOn(cacophony, 'createWorkletNode')
        .mockResolvedValue({} as any);

      await cacophony.loadWorklets(controller.signal);

      expect(createWorkletSpy).toHaveBeenCalledWith(
        "phase-vocoder",
        expect.any(String),
        controller.signal
      );
    });

    it("createWorkletNode passes AbortSignal to addModule when needed", async () => {
      const controller = new AbortController();
      
      // Mock AudioWorkletNode constructor to throw first, then succeed
      vi.mocked(AudioWorkletNode)
        .mockImplementationOnce(() => {
          throw new Error("Worklet not loaded");
        })
        .mockImplementationOnce(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
          port: {
            postMessage: vi.fn(),
            addEventListener: vi.fn(),
          },
        }) as any);

      await cacophony.createWorkletNode("test-worklet", "https://example.com/worklet.js", controller.signal);

      expect(mockAudioWorklet.addModule).toHaveBeenCalledWith(
        "https://example.com/worklet.js",
        { credentials: "same-origin", signal: controller.signal }
      );
    });

    it("createWorkletNode handles AbortError during addModule", async () => {
      const controller = new AbortController();
      
      // Mock AudioWorkletNode constructor to always throw (simulating worklet not loaded)
      vi.mocked(AudioWorkletNode).mockImplementation(() => {
        throw new Error("Worklet not loaded");
      });
      
      // Mock addModule to throw AbortError
      mockAudioWorklet.addModule.mockRejectedValue(
        new DOMException("Operation was aborted", "AbortError")
      );

      controller.abort();

      await expect(
        cacophony.createWorkletNode("test-worklet", "https://example.com/worklet.js", controller.signal)
      ).rejects.toMatchObject({
        name: "AbortError"
      });

      expect(mockAudioWorklet.addModule).toHaveBeenCalledWith(
        "https://example.com/worklet.js",
        { credentials: "same-origin", signal: controller.signal }
      );
    });

    it("createWorkletNode works without AbortSignal (backward compatibility)", async () => {
      // Mock AudioWorkletNode constructor to throw first, then succeed
      vi.mocked(AudioWorkletNode)
        .mockImplementationOnce(() => {
          throw new Error("Worklet not loaded");
        })
        .mockImplementationOnce(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
          port: {
            postMessage: vi.fn(),
            addEventListener: vi.fn(),
          },
        }) as any);

      await cacophony.createWorkletNode("test-worklet", "https://example.com/worklet.js");

      expect(mockAudioWorklet.addModule).toHaveBeenCalledWith(
        "https://example.com/worklet.js",
        { credentials: "same-origin" }
      );
    });

    it("createWorkletNode returns immediately if worklet already loaded", async () => {
      const controller = new AbortController();
      
      // Mock AudioWorkletNode constructor to succeed immediately
      vi.mocked(AudioWorkletNode).mockImplementation(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        port: {
          postMessage: vi.fn(),
          addEventListener: vi.fn(),
        },
      }) as any);

      const result = await cacophony.createWorkletNode("loaded-worklet", "https://example.com/worklet.js", controller.signal);

      expect(result).toBeDefined();
      expect(mockAudioWorklet.addModule).not.toHaveBeenCalled();
    });

    it("loadWorklets works without AbortSignal (backward compatibility)", async () => {
      const createWorkletSpy = vi.spyOn(cacophony, 'createWorkletNode')
        .mockResolvedValue({} as any);

      await cacophony.loadWorklets();

      expect(createWorkletSpy).toHaveBeenCalledWith(
        "phase-vocoder",
        expect.any(String),
        undefined
      );
    });

    it("loadWorklets handles missing audioWorklet gracefully", async () => {
      const controller = new AbortController();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Remove audioWorklet from context
      Object.defineProperty(audioContextMock, 'audioWorklet', {
        value: null,
        writable: true,
        configurable: true,
      });

      await cacophony.loadWorklets(controller.signal);

      expect(consoleSpy).toHaveBeenCalledWith("AudioWorklet not supported");
      
      consoleSpy.mockRestore();
    });

    it("createWorkletNode throws error when audioWorklet not supported", async () => {
      const controller = new AbortController();
      
      // Remove audioWorklet from context
      Object.defineProperty(audioContextMock, 'audioWorklet', {
        value: null,
        writable: true,
        configurable: true,
      });

      await expect(
        cacophony.createWorkletNode("test-worklet", "https://example.com/worklet.js", controller.signal)
      ).rejects.toThrow("AudioWorklet not supported");
    });
  });
});
