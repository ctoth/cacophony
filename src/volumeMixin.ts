import type { FadeType } from "./cacophony";
import type { GainNode } from "./context";
import type { FilterManager } from "./filters";

export type VolumeCloneOverrides = {
  volume?: number;
};

type Constructor<T = FilterManager> = abstract new (...args: any[]) => T;

type ActiveFade = {
  timeout: ReturnType<typeof setTimeout>;
  resolve: () => void;
  node: GainNode;
  target: number;
  type: FadeType;
};

export function VolumeMixin<TBase extends Constructor>(Base: TBase) {
  abstract class VolumeMixin extends Base {
    gainNode?: GainNode;
    _fadeTimeout?: ReturnType<typeof setTimeout>;
    _isFading: boolean = false;
    private _activeFade?: ActiveFade;

    setGainNode(gainNode: GainNode) {
      this.gainNode = gainNode;
    }

    cleanup(): void {
      // cancelFade resolves any pending fade promise synchronously, so
      // awaiters of an in-flight fade unblock before the gainNode is torn down.
      this.cancelFade();
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = undefined;
      }
      super.cleanup();
    }

    /**
     * Gets the current volume of the audio.
     * @throws {Error} Throws an error if the sound has been cleaned up.
     */

    get volume(): number {
      if (!this.gainNode) {
        throw new Error("Cannot get volume of a sound that has been cleaned up");
      }
      return this.gainNode.gain.value;
    }

    /**
     * Sets the volume of the audio.
     * @throws {Error} Throws an error if the sound has been cleaned up.
     */

    set volume(v: number) {
      if (!this.gainNode) {
        throw new Error("Cannot set volume of a sound that has been cleaned up");
      }
      this.cancelFade();
      this.gainNode.gain.value = v;
    }

    /**
     * Whether a fade is currently in progress.
     */
    get isFading(): boolean {
      return this._isFading;
    }

    /**
     * Fades the volume to a target value over a duration.
     * @param {number} value - The target volume (0 to 1).
     * @param {number} duration - The fade duration in milliseconds.
     * @param {FadeType} type - The fade curve type, "linear" or "exponential". Defaults to "linear".
     * @returns {Promise<void>} Resolves when the fade completes on a live context, or when its automation has been
     * scheduled on an offline context.
     */
    fadeTo(value: number, duration: number, type: FadeType = "linear"): Promise<void> {
      if (!this.gainNode) {
        throw new Error("Cannot fade a sound that has been cleaned up");
      }
      this.cancelFade();

      // Capture the gainNode at fade start so the timeout closes over the node
      // present when fadeTo was called -- not whichever node (or undefined)
      // this.gainNode happens to point at when the timer fires.
      const node = this.gainNode;
      const now = node.context.currentTime;
      const endTime = now + duration / 1000;

      node.gain.setValueAtTime(node.gain.value, now);

      if (type === "exponential") {
        node.gain.exponentialRampToValueAtTime(value === 0 ? 0.0001 : value, endTime);
      } else {
        node.gain.linearRampToValueAtTime(value, endTime);
      }

      if ("startRendering" in node.context) {
        if (value === 0 && type === "exponential") {
          node.gain.setValueAtTime(0, endTime);
        }
        this._isFading = false;
        return Promise.resolve();
      }

      this._isFading = true;

      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // If this fade was superseded (cancelled / re-fired) the active-fade
          // slot has already been cleared by cancelFade. Bail without resolving
          // a second time.
          if (this._activeFade?.timeout !== timeout) {
            return;
          }
          this._activeFade = undefined;
          this._fadeTimeout = undefined;
          this._isFading = false;
          // Web Audio's exponentialRampToValueAtTime requires a strict-positive
          // target, so the ramp went to 0.0001. Snap to 0 at completion.
          if (value === 0 && type === "exponential") {
            node.gain.value = 0;
          }
          resolve();
        }, duration);
        this._activeFade = { timeout, resolve, node, target: value, type };
        this._fadeTimeout = timeout;
      });
    }

    /**
     * Cancels any in-progress fade. The fade's pending promise is resolved
     * (Option A: cancellation is not an error; awaiters learn the outcome by
     * reading the resulting volume). Safe to call repeatedly.
     */
    cancelFade(): void {
      const active = this._activeFade;
      this._activeFade = undefined;
      if (this._fadeTimeout !== undefined) {
        clearTimeout(this._fadeTimeout);
        this._fadeTimeout = undefined;
      }
      if (active && this.gainNode) {
        const node = this.gainNode;
        const now = node.context.currentTime;
        node.gain.cancelScheduledValues(now);
        // A cancelled fade-to-zero exponential would otherwise leave the gain
        // latched at the 0.0001 ramp target. Snap to 0 so the audible state
        // matches the caller's intent at the moment they cancelled.
        if (active.target === 0 && active.type === "exponential") {
          node.gain.value = 0;
        } else {
          // For all other cancellations, leave the gain wherever the ramp had
          // reached -- pin it there so no further scheduled values apply.
          node.gain.setValueAtTime(node.gain.value, now);
        }
      }
      this._isFading = false;
      // Resolve LAST: any handler attached to the fade promise will observe
      // the post-cancel volume and isFading === false.
      if (active) {
        active.resolve();
      }
    }

    /**
     * Fades in from silence to the current volume.
     * @param {number} duration - The fade duration in milliseconds.
     * @param {FadeType} type - The fade curve type. Defaults to "linear".
     * @returns {Promise<void>} Resolves when the fade completes.
     */
    fadeIn(duration: number, type?: FadeType): Promise<void> {
      if (!this.gainNode) {
        throw new Error("Cannot fade a sound that has been cleaned up");
      }
      const target = this.gainNode.gain.value;
      this.gainNode.gain.setValueAtTime(0.0001, this.gainNode.context.currentTime);
      return this.fadeTo(target, duration, type);
    }

    /**
     * Fades out from the current volume to silence.
     * @param {number} duration - The fade duration in milliseconds.
     * @param {FadeType} type - The fade curve type. Defaults to "linear".
     * @returns {Promise<void>} Resolves when the fade completes.
     */
    fadeOut(duration: number, type?: FadeType): Promise<void> {
      return this.fadeTo(0, duration, type);
    }
  }

  return VolumeMixin;
}
