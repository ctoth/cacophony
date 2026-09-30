import type { FadeType } from "./cacophony";
import type { AudioParam } from "./context";

/** @internal Shared AudioParam scheduling; callers own cancellation and anchoring. */
export function rampAudioParam(
  param: AudioParam,
  value: number,
  now: number,
  options?: { duration?: number; type?: FadeType; startValue?: number },
): void {
  const duration = options?.duration;
  if (duration === undefined || duration <= 0) {
    param.setValueAtTime(value, now);
    return;
  }
  param.setValueAtTime(options?.startValue ?? param.value, now);
  const endTime = now + duration / 1000;
  if (options?.type === "exponential") {
    param.exponentialRampToValueAtTime(value === 0 ? 0.0001 : value, endTime);
  } else {
    param.linearRampToValueAtTime(value, endTime);
  }
}
