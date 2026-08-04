import type Hls from "hls.js";
import type { ErrorData, Events } from "hls.js";

const HLS_NOT_INSTALLED_MESSAGE = "hls.js is not installed; install hls.js or use a direct stream URL.";
const HLS_UNSUPPORTED_MESSAGE =
  "HLS playback is unavailable because Media Source Extensions are not supported in this browser; use a direct stream URL.";

type HlsErrorListener = (error: Error, recoverable: boolean) => void;

function isMissingHlsModule(cause: unknown): boolean {
  let current = cause;
  const visited = new Set<Error>();
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    const code = (current as Error & { code?: unknown }).code;
    if (current.message.includes("hls.js") && (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND")) {
      return true;
    }
    current = (current as Error & { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Owns one optional hls.js instance and its media-element attachment.
 *
 * The module is loaded only for `.m3u8` streams without native HLS support, so
 * consumers that do not install the optional peer never load it.
 */
export class HlsAdapter {
  private destroyed = false;
  private errorListenerRegistered = false;

  private readonly handleError = (_event: string, data: ErrorData): void => {
    const message = `hls.js ${data.type}: ${data.details}`;
    const error = new Error(message, data.error ? { cause: data.error } : undefined);
    this.onError(error, false);
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
      if (isMissingHlsModule(cause)) {
        throw new Error(HLS_NOT_INSTALLED_MESSAGE, { cause });
      }
      throw cause;
    }

    if (!HlsConstructor.isSupported()) {
      throw new Error(HLS_UNSUPPORTED_MESSAGE);
    }

    return new HlsAdapter(new HlsConstructor(), HlsConstructor.Events.ERROR, onError);
  }

  attach(audio: HTMLAudioElement, url: string): void {
    if (this.destroyed) {
      throw new Error("HlsAdapter has been destroyed");
    }
    if (!this.errorListenerRegistered) {
      this.hls.on(this.errorEvent, this.handleError);
      this.errorListenerRegistered = true;
    }
    this.hls.loadSource(url);
    this.hls.attachMedia(audio);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.errorListenerRegistered) {
      this.hls.off(this.errorEvent, this.handleError);
      this.errorListenerRegistered = false;
    }
    this.hls.detachMedia();
    this.hls.destroy();
  }
}
