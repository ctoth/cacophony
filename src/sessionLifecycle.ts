import type { BaseContext } from "./context";
import type { DeviceChangeEvent } from "./events";
import type { CacophonyLogger } from "./logger";

export interface SessionLifecycleOptions {
  context: BaseContext;
  isUserPaused: () => boolean;
  onStateChange: (state: string) => void;
  onDeviceChange: (event: DeviceChangeEvent) => void;
  onClosed: () => void;
  logger: CacophonyLogger;
}

/** Observe browser sessions and attempt visible-page recovery. @internal */
export function installSessionLifecycle(options: SessionLifecycleOptions): () => void {
  if (typeof document === "undefined" || typeof navigator === "undefined") return () => {};
  const { context, isUserPaused, onStateChange, onDeviceChange, onClosed, logger } = options;
  const observable = context as BaseContext & {
    state?: string;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
  };
  const doc = document;
  const host = typeof window === "undefined" ? undefined : window;
  const media = navigator.mediaDevices;
  let disposed = false;
  let recovering = false;
  let lastState = observable.state;
  // An autoplay-locked context has never run; its first start belongs to the gesture unlock.
  let hasRun = lastState === "running";

  const recover = () => {
    if (
      disposed ||
      recovering ||
      !hasRun ||
      isUserPaused() ||
      doc.visibilityState !== "visible" ||
      (observable.state !== "suspended" && observable.state !== "interrupted") ||
      typeof context.resume !== "function"
    )
      return;
    recovering = true;
    try {
      context.resume().then(
        () => {
          recovering = false;
          if (!disposed && isUserPaused() && observable.state === "running") {
            context.suspend?.().catch((error: unknown) => {
              if (!disposed) logger.warn("[cacophony/sessionLifecycle] restoring user pause failed:", error);
            });
          }
        },
        (error: unknown) => {
          recovering = false;
          if (!disposed) logger.warn("[cacophony/sessionLifecycle] resume failed:", error);
        },
      );
    } catch (error) {
      recovering = false;
      logger.warn("[cacophony/sessionLifecycle] resume failed:", error);
    }
  };

  const handleStateChange = () => {
    if (disposed) return;
    const state = observable.state;
    if (state === lastState || state === undefined) return;
    lastState = state;
    if (state === "running") hasRun = true;
    if (state === "closed") {
      onClosed();
      return;
    }
    try {
      onStateChange(state);
    } finally {
      recover();
    }
  };

  let deviceRequest = 0;
  const handleDeviceChange = () => {
    if (disposed || typeof media?.enumerateDevices !== "function") return;
    const request = ++deviceRequest;
    void (async () => {
      try {
        const devices = await media.enumerateDevices();
        if (!disposed && request === deviceRequest) {
          onDeviceChange({ devices: devices.filter((device) => device.kind === "audiooutput"), timestamp: Date.now() });
        }
      } catch (error) {
        if (!disposed) logger.warn("[cacophony/sessionLifecycle] device enumeration failed:", error);
      }
    })();
  };

  observable.addEventListener?.("statechange", handleStateChange);
  doc.addEventListener("visibilitychange", recover);
  host?.addEventListener("pageshow", recover);
  host?.addEventListener("focus", recover);
  media?.addEventListener?.("devicechange", handleDeviceChange);

  return () => {
    if (disposed) return;
    disposed = true;
    observable.removeEventListener?.("statechange", handleStateChange);
    doc.removeEventListener("visibilitychange", recover);
    host?.removeEventListener("pageshow", recover);
    host?.removeEventListener("focus", recover);
    media?.removeEventListener?.("devicechange", handleDeviceChange);
  };
}
