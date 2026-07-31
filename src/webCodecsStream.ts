import { ADTS, AudioSampleSink, FLAC, Input, type InputAudioTrack, MP3, MP4, OGG, UrlSource, WAVE } from "mediabunny";
import type { StreamCapabilities } from "./cacophony";
import type { PcmStreamPullSource, PcmStreamSound } from "./pcmStream";

interface DecoderSession {
  channelCount: number;
  duration: number;
  input: Input;
  live: boolean;
  sampleRate: number;
  seekable: boolean;
  sink: AudioSampleSink;
}

interface OpenSessionResult {
  session: DecoderSession | null;
  unsupported: boolean;
}

export type WebCodecsStreamSound = PcmStreamSound & {
  readonly soundType: "streaming";
  readonly streamCapabilities: StreamCapabilities;
};

/**
 * Pulls encoded URL media through Mediabunny's demuxers and WebCodecs-backed
 * audio sink, then writes interleaved float PCM into the existing ring buffer.
 */
export class WebCodecsPullAdapter implements PcmStreamPullSource {
  private currentRun?: AbortController;
  private disposed = false;
  private pendingInput?: Input;
  private session?: DecoderSession;
  private sound?: PcmStreamSound;

  private readonly handleAbort = (): void => {
    this.cleanup();
  };

  private constructor(
    private readonly url: string,
    private readonly targetSampleRate: number,
    private readonly signal?: AbortSignal,
  ) {
    this.signal?.addEventListener("abort", this.handleAbort, { once: true });
  }

  static async open(url: string, targetSampleRate: number, signal?: AbortSignal): Promise<WebCodecsPullAdapter | null> {
    signal?.throwIfAborted();
    const adapter = new WebCodecsPullAdapter(url, targetSampleRate, signal);
    try {
      const result = await adapter.openSession();
      if (result.unsupported || !result.session) {
        adapter.cleanup();
        return null;
      }
      adapter.session = result.session;
      return adapter;
    } catch (error) {
      adapter.cleanup();
      signal?.throwIfAborted();
      if ((error as { name?: string } | null)?.name === "UnsupportedInputFormatError") {
        return null;
      }
      throw error;
    }
  }

  get channelCount(): number {
    if (!this.session) {
      throw new Error("WebCodecs stream adapter is not initialized");
    }
    return this.session.channelCount;
  }

  get capabilities(): StreamCapabilities {
    if (!this.session) {
      throw new Error("WebCodecs stream adapter is not initialized");
    }
    return {
      duration: this.session.duration,
      live: this.session.live,
      seekable: this.session.seekable,
      transport: "webcodecs",
    };
  }

  attach(sound: PcmStreamSound): WebCodecsStreamSound {
    if (this.disposed || !this.session) {
      throw new Error("Cannot attach a disposed WebCodecs stream adapter");
    }
    this.sound = sound;
    sound.attachPullSource(this, this.capabilities);
    this.startPump(this.session, 0);
    return sound as WebCodecsStreamSound;
  }

  seek(time: number): void {
    if (!Number.isFinite(time) || time < 0) {
      throw new RangeError("Stream seek time must be a finite non-negative number");
    }
    if (!this.session || !this.sound || this.disposed) {
      throw new Error("Cannot seek a WebCodecs stream that has been cleaned up");
    }
    if (this.session.live) {
      throw new Error("Live streams do not support seeking");
    }
    if (!this.session.seekable) {
      throw new Error("This stream's server does not support range seeking");
    }

    const wasPlaying = this.sound.isPlaying;
    this.sound.stop();
    if (wasPlaying) {
      this.sound.play();
    }
    this.currentRun?.abort();
    this.session.input.dispose();
    this.session = undefined;
    void this.reopenAndPump(time);
  }

  cleanup(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.signal?.removeEventListener("abort", this.handleAbort);
    this.currentRun?.abort();
    this.pendingInput?.dispose();
    this.pendingInput = undefined;
    this.session?.input.dispose();
    this.session = undefined;
  }

  private async reopenAndPump(time: number): Promise<void> {
    try {
      const result = await this.openSession();
      if (this.disposed) {
        result.session?.input.dispose();
        return;
      }
      if (!result.session) {
        return;
      }
      if (result.session.channelCount !== this.channelCountForSound()) {
        result.session.input.dispose();
        throw new Error("The audio channel count changed while seeking");
      }
      this.session = result.session;
      this.startPump(result.session, time);
    } catch (error) {
      if (!this.disposed && !this.signal?.aborted) {
        this.sound?.handlePullError(error);
      }
    }
  }

  private channelCountForSound(): number {
    return this.sound?.inputChannelCount ?? 0;
  }

  private startPump(session: DecoderSession, startTime: number): void {
    this.currentRun?.abort();
    const run = new AbortController();
    this.currentRun = run;
    void this.pump(session, startTime, run.signal).catch((error: unknown) => {
      if (!run.signal.aborted && !this.disposed && !this.signal?.aborted) {
        this.sound?.handlePullError(error);
      }
    });
  }

  private async pump(session: DecoderSession, startTime: number, runSignal: AbortSignal): Promise<void> {
    const sound = this.sound;
    if (!sound) {
      return;
    }
    const resampler = new StreamingPcmResampler(session.sampleRate, this.targetSampleRate, session.channelCount);

    for await (const sample of session.sink.samples(startTime)) {
      if (runSignal.aborted || this.disposed) {
        sample.close();
        return;
      }
      try {
        const options = { format: "f32" as const, planeIndex: 0 };
        const data = new ArrayBuffer(sample.allocationSize(options));
        sample.copyTo(data, options);
        const output = resampler.add(new Float32Array(data));
        await this.enqueue(sound, output, session.channelCount, runSignal);
      } finally {
        sample.close();
      }
    }

    const tail = resampler.finalize();
    await this.enqueue(sound, tail, session.channelCount, runSignal);
    if (!runSignal.aborted && !this.disposed) {
      sound.end();
    }
  }

  private async enqueue(
    sound: PcmStreamSound,
    samples: Float32Array,
    channelCount: number,
    signal: AbortSignal,
  ): Promise<void> {
    const maximumFrames = Math.max(1, Math.floor(this.targetSampleRate / 4));
    const maximumSamples = maximumFrames * channelCount;
    for (let offset = 0; offset < samples.length; offset += maximumSamples) {
      const chunk = samples.slice(offset, Math.min(samples.length, offset + maximumSamples));
      let written = false;
      while (!written) {
        signal.throwIfAborted();
        const before = sound.bufferedDuration;
        const hasCapacity = sound.write(chunk);
        written = sound.bufferedDuration > before;
        if (!hasCapacity) {
          await waitForDrain(sound, signal);
        }
      }
    }
  }

  private async openSession(): Promise<OpenSessionResult> {
    this.signal?.throwIfAborted();
    let sawRangeResponse = false;
    const source = new UrlSource(this.url, {
      fetchFn: async (input, init) => {
        const response = await globalThis.fetch(input, init);
        if (response.status === 206 || response.headers.get("Accept-Ranges")?.toLowerCase() === "bytes") {
          sawRangeResponse = true;
        }
        return response;
      },
    });
    const input = new Input({ formats: [MP3, ADTS, MP4, OGG, FLAC, WAVE], source });
    this.pendingInput = input;
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track || !(await track.canDecode())) {
        this.pendingInput = undefined;
        input.dispose();
        return { session: null, unsupported: true };
      }
      const session = await this.describeSession(input, track, sawRangeResponse);
      this.signal?.throwIfAborted();
      if (this.disposed) {
        this.pendingInput = undefined;
        input.dispose();
        return { session: null, unsupported: false };
      }
      this.pendingInput = undefined;
      return { session, unsupported: false };
    } catch (error) {
      if (this.pendingInput === input) {
        this.pendingInput = undefined;
        input.dispose();
      }
      throw error;
    }
  }

  private async describeSession(
    input: Input,
    track: InputAudioTrack,
    sawRangeResponse: boolean,
  ): Promise<DecoderSession> {
    const [channelCount, sampleRate, live, metadataDuration] = await Promise.all([
      track.getNumberOfChannels(),
      track.getSampleRate(),
      track.isLive(),
      track.getDurationFromMetadata({ skipLiveWait: true }),
    ]);
    return {
      channelCount,
      duration: live || metadataDuration === null ? Number.POSITIVE_INFINITY : metadataDuration,
      input,
      live,
      sampleRate,
      seekable: !live && sawRangeResponse,
      sink: new AudioSampleSink(track),
    };
  }
}

function waitForDrain(sound: PcmStreamSound, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const unsubscribe = sound.on("drain", () => {
      cleanup();
      resolve();
    });
    const handleAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => {
      unsubscribe();
      signal.removeEventListener("abort", handleAbort);
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

/**
 * Stateful linear-interpolation resampler for decoded stream chunks.
 *
 * This v1 implementation has no anti-aliasing filter. Downsampling can fold
 * source frequencies above the target Nyquist frequency into the audible band;
 * use a band-limited resampler if that quality trade-off is unacceptable.
 */
class StreamingPcmResampler {
  private inputFrames = 0;
  private nextSourcePosition = 0;
  private previousFrame?: Float32Array;

  constructor(
    private readonly sourceRate: number,
    private readonly targetRate: number,
    private readonly channelCount: number,
  ) {}

  add(input: Float32Array): Float32Array {
    if (this.sourceRate === this.targetRate) {
      this.inputFrames += input.length / this.channelCount;
      return input;
    }
    const frameCount = input.length / this.channelCount;
    const firstFrame = this.inputFrames;
    const lastFrame = firstFrame + frameCount - 1;
    const output: number[] = [];

    while (this.nextSourcePosition <= lastFrame) {
      const leftFrame = Math.floor(this.nextSourcePosition);
      const fraction = this.nextSourcePosition - leftFrame;
      if (fraction > 0 && leftFrame + 1 > lastFrame) {
        break;
      }
      for (let channel = 0; channel < this.channelCount; channel += 1) {
        const left = this.sampleAt(input, firstFrame, leftFrame, channel);
        const right = this.sampleAt(input, firstFrame, Math.min(leftFrame + 1, lastFrame), channel);
        output.push(left + (right - left) * fraction);
      }
      this.nextSourcePosition += this.sourceRate / this.targetRate;
    }

    this.inputFrames += frameCount;
    this.previousFrame = input.slice(input.length - this.channelCount);
    return Float32Array.from(output);
  }

  finalize(): Float32Array {
    if (this.sourceRate === this.targetRate || !this.previousFrame) {
      return new Float32Array();
    }
    const output: number[] = [];
    while (this.nextSourcePosition < this.inputFrames) {
      for (const sample of this.previousFrame) {
        output.push(sample);
      }
      this.nextSourcePosition += this.sourceRate / this.targetRate;
    }
    return Float32Array.from(output);
  }

  private sampleAt(input: Float32Array, firstFrame: number, frame: number, channel: number): number {
    if (frame < firstFrame) {
      return this.previousFrame?.[channel] ?? input[channel] ?? 0;
    }
    return input[(frame - firstFrame) * this.channelCount + channel] ?? 0;
  }
}
