import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PcmStreamSound } from "./pcmStream";
import { audioContextMock, cacophony, expectReachable } from "./setupTests";
import { Sound } from "./sound";
import { WebCodecsPullAdapter } from "./webCodecsStream";

const media = vi.hoisted(() => ({
  formats: {
    adts: Symbol("adts"),
    flac: Symbol("flac"),
    mp3: Symbol("mp3"),
    mp4: Symbol("mp4"),
    ogg: Symbol("ogg"),
    wave: Symbol("wave"),
  },
  disposeCount: 0,
  duration: 12,
  fetchInits: [] as RequestInit[],
  inputs: [] as Array<{ source: unknown }>,
  live: false,
  sample: {
    allocationSize: vi.fn(() => 16),
    close: vi.fn(),
    copyTo: vi.fn((destination: AllowSharedBufferSource) => {
      new Float32Array(destination as ArrayBuffer).set([0.25, -0.25, 0.5, -0.5]);
    }),
    numberOfChannels: 2,
    numberOfFrames: 2,
    sampleRate: 44_100,
  },
  sampleStarts: [] as number[],
  sourceOptions: undefined as { fetchFn?: typeof fetch } | undefined,
  sourceUrl: "",
}));

vi.mock("mediabunny", () => {
  class UrlSource {
    constructor(
      public url: string,
      public options: { fetchFn?: typeof fetch } = {},
    ) {
      media.sourceUrl = url;
      media.sourceOptions = options;
    }
  }

  class Input {
    public source: UrlSource;

    constructor({ source }: { source: UrlSource }) {
      this.source = source;
      media.inputs.push({ source });
    }

    async getPrimaryAudioTrack() {
      await this.source.options.fetchFn?.(this.source.url, {
        headers: { Range: "bytes=0-65535" },
      });
      return {
        canDecode: vi.fn().mockResolvedValue(true),
        getDurationFromMetadata: vi.fn().mockImplementation(async () => (media.live ? null : media.duration)),
        getNumberOfChannels: vi.fn().mockResolvedValue(media.sample.numberOfChannels),
        getSampleRate: vi.fn().mockResolvedValue(media.sample.sampleRate),
        isLive: vi.fn().mockImplementation(async () => media.live),
      };
    }

    dispose() {
      media.disposeCount += 1;
    }
  }

  class AudioSampleSink {
    async *samples(start = 0) {
      media.sampleStarts.push(start);
      yield media.sample;
    }
  }

  return {
    ADTS: media.formats.adts,
    AudioSampleSink,
    FLAC: media.formats.flac,
    Input,
    MP3: media.formats.mp3,
    MP4: media.formats.mp4,
    OGG: media.formats.ogg,
    UrlSource,
    WAVE: media.formats.wave,
  };
});

function mockAudioWorklet(): void {
  Object.defineProperty(audioContextMock, "audioWorklet", {
    configurable: true,
    value: { addModule: vi.fn().mockResolvedValue(undefined) },
    writable: true,
  });
}

function enableAudioDecoder(): void {
  Object.defineProperty(globalThis, "AudioDecoder", {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
}

function disableAudioDecoder(): void {
  Reflect.deleteProperty(globalThis, "AudioDecoder");
}

describe("WebCodecs URL streaming", () => {
  beforeEach(() => {
    mockAudioWorklet();
    enableAudioDecoder();
    media.disposeCount = 0;
    media.duration = 12;
    media.fetchInits.length = 0;
    media.inputs.length = 0;
    media.live = false;
    media.sample.allocationSize.mockClear();
    media.sample.close.mockClear();
    media.sample.copyTo.mockClear();
    media.sample.sampleRate = audioContextMock.sampleRate;
    media.sampleStarts.length = 0;
    media.sourceOptions = undefined;
    media.sourceUrl = "";
    global.fetch = vi.fn(async (_input, init = {}) => {
      media.fetchInits.push(init);
      return new Response(new Uint8Array([0]), {
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": "bytes 0-0/1",
        },
        status: 206,
      });
    });
  });

  afterEach(() => {
    disableAudioDecoder();
  });

  it("decodes URL audio into the existing routable PCM source through the public API", async () => {
    const stream = await cacophony.createStream("https://example.com/music.ogg");

    expect(stream).toBeInstanceOf(PcmStreamSound);
    expect(stream.streamCapabilities).toEqual({
      duration: 12,
      live: false,
      seekable: true,
      transport: "webcodecs",
    });

    const bus = cacophony.createBus("decoded-stream");
    stream.routeTo(bus);
    stream.position = [1, 2, 3];
    stream.addFilter(cacophony.createBiquadFilter({ frequency: 1_200 }));
    const meter = await cacophony.createLoudnessMeter(bus);
    const [playback] = stream.play();

    await vi.waitFor(() => expect(media.sample.close).toHaveBeenCalledOnce());

    expect(playback.filters).toHaveLength(1);
    expect(playback.position).toEqual([1, 2, 3]);
    expectReachable(playback.source!, bus.output);
    expectReachable(playback.source!, meter.workletNode);
    expect(playback.source!.port.postMessage).toHaveBeenCalledWith({
      samples: new Float32Array([0.25, -0.25, 0.5, -0.5]),
      type: "write",
    });
    expect(media.sourceUrl).toBe("https://example.com/music.ogg");
  });

  it("threads stereo panning through the WebCodecs stream tier", async () => {
    const stream = await cacophony.createStream("https://example.com/music.ogg", undefined, "stereo");
    expect(stream).toBeInstanceOf(PcmStreamSound);

    const [playback] = stream.play();

    expect(playback.panType).toBe("stereo");
  });

  it("seeks by reopening the range-backed decoder at the requested timestamp", async () => {
    const stream = await cacophony.createStream("https://example.com/music.mp3");

    await vi.waitFor(() => expect(media.sampleStarts).toEqual([0]));
    stream.seek(4.5);
    await vi.waitFor(() => expect(media.sampleStarts).toEqual([0, 4.5]));

    expect(media.disposeCount).toBe(1);
    expect(media.fetchInits).toHaveLength(2);
    expect(new Headers(media.fetchInits[1]?.headers).get("Range")).toBe("bytes=0-65535");
  });

  it("reports a pending seek while the decoder is reopening", async () => {
    let resolveReopen: ((response: Response) => void) | undefined;
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0]), {
          headers: { "Accept-Ranges": "bytes" },
          status: 206,
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveReopen = resolve;
          }),
      );
    const stream = await cacophony.createStream("https://example.com/music.mp3");

    stream.seek(4.5);

    expect(() => stream.seek(6)).toThrow("Cannot seek while another WebCodecs seek is pending");
    resolveReopen?.(
      new Response(new Uint8Array([0]), {
        headers: { "Accept-Ranges": "bytes" },
        status: 206,
      }),
    );
    await vi.waitFor(() => expect(media.sampleStarts).toEqual([0, 4.5]));
  });

  it("does not invent a channel-count mismatch without an attached sound", async () => {
    const adapter = await WebCodecsPullAdapter.open("https://example.com/music.mp3", audioContextMock.sampleRate);
    expect(adapter).not.toBeNull();
    const adapterState = adapter as unknown as {
      reopenAndPump(time: number): Promise<void>;
      session?: { input: { dispose(): void } };
    };
    adapterState.session?.input.dispose();
    adapterState.session = undefined;

    await adapterState.reopenAndPump(4.5);

    expect(media.disposeCount).toBe(1);
    expect(adapter?.channelCount).toBe(2);
  });

  it("reports live sources as unseekable with infinite duration", async () => {
    media.live = true;
    global.fetch = vi.fn(async (_input, init = {}) => {
      media.fetchInits.push(init);
      return new Response(new Uint8Array([0]), { status: 200 });
    });

    const stream = await cacophony.createStream("https://example.com/live.aac");

    expect(stream.streamCapabilities).toEqual({
      duration: Number.POSITIVE_INFINITY,
      live: true,
      seekable: false,
      transport: "webcodecs",
    });
    expect(() => stream.seek(2)).toThrow("Live streams do not support seeking");
  });

  it("aborts fetch, decoder, and PCM playback without logging", async () => {
    const controller = new AbortController();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stream = await cacophony.createStream("https://example.com/music.flac", controller.signal);
    const [playback] = stream.play();
    const source = playback.source!;

    controller.abort();
    await Promise.resolve();

    expect(media.disposeCount).toBe(1);
    expect(source.disconnect).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("falls back to the media element when WebCodecs is unavailable", async () => {
    disableAudioDecoder();

    const stream = await cacophony.createStream("https://example.com/music.wav");

    expect(stream).toBeInstanceOf(Sound);
    expect(stream.streamCapabilities?.transport).toBe("media-element");
    expect(global.Audio).toHaveBeenCalled();
  });
});
