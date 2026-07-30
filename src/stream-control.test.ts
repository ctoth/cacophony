import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(sound.soundType).toBe("streaming");
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

describe("Stream contract documentation", () => {
  it("describes WebCodecs streaming, the media fallback, and removes the dead chunk decoder", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const cacophonySource = readFileSync(join(process.cwd(), "src", "cacophony.ts"), "utf8");

    expect(readme).toMatch(/media-element-backed/i);
    expect(readme).toMatch(/WebCodecs `AudioDecoder`/i);
    expect(readme).toMatch(/native HLS[\s\S]{0,80}Safari/i);
    expect(readme).toMatch(/npm install hls\.js/);
    expect(readme).toMatch(/optional peer dependency/i);
    expect(readme).not.toMatch(/hls\.js adapter issue/i);
    expect(cacophonySource).toMatch(/WebCodecsPullAdapter/);
    expect(cacophonySource).toMatch(/createMediaSound\(url, "streaming"/);
    expect(existsSync(join(process.cwd(), "src", "stream.ts"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src", "stream.test.ts"))).toBe(false);
  });

  it("documents the push PCM source and its capability limits", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

    expect(readme).toMatch(/createPcmStreamSound/);
    expect(readme).toMatch(/interleaved Float32Array/i);
    expect(readme).toMatch(/bufferedDuration/);
    expect(readme).toMatch(/underrun[^.]*silence/i);
    expect(readme).toMatch(/Seek is not supported/i);
    expect(readme).toMatch(/Loop is not\s+supported/i);
  });
});
