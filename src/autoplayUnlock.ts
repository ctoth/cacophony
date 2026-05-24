import type { BaseContext } from "./context";

/**
 * Autoplay unlock — Howler-parity automatic AudioContext resume on first
 * user gesture.
 *
 * On mobile browsers (especially iOS Safari) an `AudioContext` constructed
 * before any user interaction is created in `suspended` state. It will not
 * produce sound until BOTH:
 *
 *   1. `context.resume()` is called, AND
 *   2. an `AudioBufferSourceNode` is created and started inside the user
 *      gesture's call stack (the iOS "primer").
 *
 * Many callers do (1) but not (2), and hear silence with no obvious cause.
 * This module installs one-time `touchend` / `click` / `keydown` listeners
 * on `document.body` (or `document` as fallback). The first one to fire
 * resumes the context, plays a 1-sample silent primer inside the gesture
 * call stack, removes all three listeners, and calls the `onUnlock` callback.
 *
 * Design adapted (not copied) from Howler.js `_unlockAudio` — MIT licensed.
 */

const UNLOCK_EVENT_TYPES: ReadonlyArray<"touchend" | "click" | "keydown"> = ["touchend", "click", "keydown"];

/**
 * A `Document`-like type with the methods we need. Avoids a hard dependency
 * on DOM lib types so the package keeps building when `lib: ["dom"]` is off.
 */
interface DocumentLike {
  body?: EventTargetLike | null;
  addEventListener(type: string, listener: (ev: any) => void, options?: any): void;
  removeEventListener(type: string, listener: (ev: any) => void, options?: any): void;
}

interface EventTargetLike {
  addEventListener(type: string, listener: (ev: any) => void, options?: any): void;
  removeEventListener(type: string, listener: (ev: any) => void, options?: any): void;
}

/**
 * Options for `installAutoplayUnlock`.
 */
export interface AutoplayUnlockOptions {
  /**
   * The audio context that should be resumed and primed.
   */
  context: BaseContext;

  /**
   * Called after the context has been resumed and the primer buffer has been
   * started. Used by `Cacophony` to emit the public `unlock` event.
   * Errors thrown by the callback are caught and logged so a faulty listener
   * cannot break the unlock flow.
   */
  onUnlock: () => void;
}

/**
 * Install one-time unlock listeners. Returns a cleanup function that removes
 * the listeners if they have not already fired (e.g. when a `Cacophony`
 * instance is torn down before the user interacts).
 *
 * If the environment is non-browser (`document` is undefined) or the context
 * is not in `suspended` state, this is a no-op and returns a no-op cleanup.
 *
 * @internal
 */
export function installAutoplayUnlock(opts: AutoplayUnlockOptions): () => void {
  const { context, onUnlock } = opts;

  // Server-side / non-browser: nothing to do.
  if (typeof document === "undefined") {
    return () => {};
  }

  // Already running: nothing to unlock.
  const state = (context as unknown as { state?: string }).state;
  if (state !== "suspended") {
    return () => {};
  }

  // `BaseContext.resume` is optional. If this context has no resume() we
  // cannot actually unlock it — installing gesture listeners would be noise,
  // and firing the `unlock` event without a fulfilled resume() would violate
  // the contract (caller would see `unlock` while `Cacophony.locked` stays
  // true, since `locked` is derived from `context.state === "suspended"`).
  // Treat the absence as "this context isn't ours to unlock" and bail.
  const resume = (context as unknown as { resume?: () => Promise<void> }).resume;
  if (typeof resume !== "function") {
    return () => {};
  }

  const doc = document as unknown as DocumentLike;
  const target: EventTargetLike = (doc.body as EventTargetLike | null | undefined) ?? doc;

  let fired = false;

  const removeAll = () => {
    for (const type of UNLOCK_EVENT_TYPES) {
      target.removeEventListener(type, handler);
    }
  };

  const handler = () => {
    if (fired) return;
    fired = true;

    // Remove listeners FIRST so a re-entrant gesture cannot re-trigger us
    // while resume() is in flight.
    removeAll();

    // Play the iOS primer INSIDE the gesture call stack. iOS requires that
    // an AudioBufferSourceNode be created and started synchronously inside
    // the gesture handler for the context to truly unlock — calling
    // resume() alone is not sufficient. A 1-sample silent buffer is the
    // minimum that satisfies the requirement and is inaudible.
    try {
      // BaseContext doesn't declare createBuffer because Cacophony's normal
      // code path always feeds an AudioBuffer constructed externally; the
      // primer needs to construct a 1-sample buffer in-place, so we widen
      // the type locally here. Both AudioContext and OfflineAudioContext
      // expose createBuffer.
      const ctxWithCreateBuffer = context as unknown as {
        createBuffer(numberOfChannels: number, length: number, sampleRate: number): unknown;
      };
      const buffer = ctxWithCreateBuffer.createBuffer(1, 1, context.sampleRate);
      const source = context.createBufferSource();
      source.buffer = buffer as any;
      source.connect(context.destination);
      // The load-bearing iOS pattern is start(0); stop(0) on a silent buffer
      // INSIDE the gesture call stack. A 1-sample non-looping buffer would
      // end on its own, but the pair is what the platform contract names.
      source.start(0);
      source.stop(0);
    } catch (err) {
      // Primer failure should not block the rest of the unlock; the
      // context.resume() call below is still useful on platforms that do
      // not require the primer.
      console.warn("[cacophony/autoplayUnlock] primer failed:", err);
    }

    // Resume the context, then emit unlock. The `unlock` event signals that
    // audio is actually playable, so we must wait for resume() to fulfill
    // before emitting. On rejection we surface the error and do NOT emit
    // unlock — a failed resume is not an unlock. `resume` is guaranteed to
    // be a function here (guarded at install time above).
    resume.call(context).then(
      () => {
        try {
          onUnlock();
        } catch (err) {
          console.error("[cacophony/autoplayUnlock] onUnlock callback threw:", err);
        }
      },
      (err: unknown) => {
        console.warn("[cacophony/autoplayUnlock] resume failed:", err);
      },
    );
  };

  for (const type of UNLOCK_EVENT_TYPES) {
    target.addEventListener(type, handler);
  }

  return removeAll;
}
