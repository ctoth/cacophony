import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundType } from "./cacophony";
import { cacophony } from "./setupTests";

describe("Stream control integration", () => {
  let mockReader: any;
  let mockResponse: any;

  beforeEach(() => {
    mockReader = {
      read: vi.fn().mockResolvedValue({ value: undefined, done: true }),
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

    global.fetch = vi.fn().mockResolvedValue(mockResponse);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("createStream returns a Sound instance", async () => {
    const sound = await cacophony.createStream("https://example.com/audio.wav");
    expect(sound).toBeDefined();
    expect(sound.constructor.name).toBe("Sound");
  });

  it("returned Sound has Streaming soundType", async () => {
    const sound = await cacophony.createStream("https://example.com/audio.wav");
    expect(sound.soundType).toBe(SoundType.Streaming);
  });

  it("returned Sound has no buffer", async () => {
    const sound = await cacophony.createStream("https://example.com/audio.wav");
    expect(sound.buffer).toBeUndefined();
  });

  it("returned Sound.preplay() creates a playback even without buffer", async () => {
    const sound = await cacophony.createStream("https://example.com/audio.wav");
    // preplay() falls through to the HTML Audio path since there's no buffer
    const playbacks = sound.preplay();
    expect(playbacks).toHaveLength(1);
  });

  it("createStream does not initiate fetch before playback", async () => {
    await cacophony.createStream("https://example.com/audio.wav");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("createStream initializes through an Audio element even when given an AbortSignal", async () => {
    const controller = new AbortController();
    await cacophony.createStream("https://example.com/audio.wav", controller.signal);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(global.Audio).toHaveBeenCalled();
  });
});
