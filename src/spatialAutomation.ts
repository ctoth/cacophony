import type { AudioParam } from "./context";

interface SpatialTarget {
  startValue: number;
  target: number;
  startTime: number;
  tau: number;
  scheduled: boolean;
}

/** @internal Time constants are seconds, unlike the millisecond fade/ramp APIs. */
export function validateSpatialSmoothingTau(tau: number): void {
  if (!Number.isFinite(tau) || tau < 0) {
    throw new RangeError("Spatial smoothing time constant must be finite and nonnegative (seconds)");
  }
}

/** @internal Owns only spatial setter automation; direct node automation must not be mixed with it. */
export class SpatialAutomation {
  private readonly targets = new Map<AudioParam, SpatialTarget>();

  target(param: AudioParam): number {
    return this.targets.get(param)?.target ?? param.value;
  }

  write(param: AudioParam, target: number, now: number, tau: number, scheduled = false): void {
    const previous = this.targets.get(param);
    if (tau > 0 && previous?.target === target && previous.tau === tau) return;
    if (tau === 0 || typeof param.setTargetAtTime !== "function") {
      if (previous && previous.tau > 0) param.cancelScheduledValues(0);
      if (scheduled) param.setValueAtTime(target, now);
      else param.value = target;
      this.targets.set(param, { startValue: target, target, startTime: now, tau: 0, scheduled });
      return;
    }
    // Recover the interrupted envelope before cancellation, without relying on param.value.
    const startValue =
      previous && previous.tau > 0
        ? previous.target +
          (previous.startValue - previous.target) * Math.exp(-Math.max(0, now - previous.startTime) / previous.tau)
        : (previous?.target ?? param.value);
    if (startValue === target) {
      this.targets.set(param, { startValue, target, startTime: now, tau: 0, scheduled });
      return;
    }
    // All events on these params belong to this controller. Prune past events as well as
    // future events so frame-by-frame writes cannot accumulate an unbounded timeline.
    param.cancelScheduledValues(0);
    param.setValueAtTime(startValue, now);
    param.setTargetAtTime(target, now, tau);
    this.targets.set(param, { startValue, target, startTime: now, tau, scheduled });
  }

  reconfigure(tau: number, now: number): void {
    for (const [param, state] of this.targets) {
      if (state.tau > 0) this.write(param, state.target, now, tau, state.scheduled);
    }
  }

  clear(): void {
    for (const [param, state] of this.targets) {
      if (state.tau > 0) param.cancelScheduledValues(0);
    }
    this.targets.clear();
  }
}
