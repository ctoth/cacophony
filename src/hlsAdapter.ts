import type Hls from "hls.js";
import type { ErrorData, Events } from "hls.js";

const HLS_UNAVAILABLE_MESSAGE =
  "HLS playback is unavailable in this browser; install hls.js or use a direct stream URL.";

type HlsErrorListener = (error: Error, recoverable: boolean) => void;

/**
 * Owns one optional hls.js instance and its media-element attachment.
 *
 * The module is loaded only for `.m3u8` streams without native HLS support, so
 * consumers that do not install the optional peer never load it.
 */
export class HlsAdapter {
  private destroyed = false;

  private readonly handleError = (_event: string, data: ErrorData): void => {
    const message = `hls.js ${data.type}: ${data.details}`;
    const error = new Error(message, data.error ? { cause: data.error } : undefined);
    this.onError(error, !data.fatal);
  };

  private constructor(
    private readonly hls: Hls,
    private readonly errorEvent: Events.ERROR,
    private readonly onError: HlsErrorListener,
  ) {}

  static async create(onError: HlsErrorListener): Promise<HlsAdapter> {
    let HlsConstructor: typeof import("hls.js").default;
    try {
      ({ default: HlsConstructor } = await import("hls.js"));
    } catch (cause) {
      throw new Error(HLS_UNAVAILABLE_MESSAGE, { cause });
    }

    if (!HlsConstructor.isSupported()) {
      throw new Error(HLS_UNAVAILABLE_MESSAGE);
    }

    return new HlsAdapter(new HlsConstructor(), HlsConstructor.Events.ERROR, onError);
  }

  attach(audio: HTMLAudioElement, url: string): void {
    this.hls.on(this.errorEvent, this.handleError);
    this.hls.loadSource(url);
    this.hls.attachMedia(audio);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.hls.off(this.errorEvent, this.handleError);
    this.hls.detachMedia();
    this.hls.destroy();
  }
}
