import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseContext } from "./context";
import { Scheduler as PublicScheduler } from "./index";
import { Scheduler } from "./scheduler";

describe("Scheduler", () => {
  let currentTime: number;
  let context: BaseContext;

  beforeEach(() => {
    vi.useFakeTimers();
    currentTime = 0;
    context = {
      get currentTime() {
        return currentTime;
      },
    } as BaseContext;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is exported from the public entrypoint", () => {
    expect(PublicScheduler).toBe(Scheduler);
  });

  it("dispatches callbacks with their context time when they enter the lookahead window", () => {
    const scheduler = new Scheduler(context);
    const callback = vi.fn();

    scheduler.schedule(callback, 0.2);
    vi.advanceTimersByTime(25);
    expect(callback).not.toHaveBeenCalled();

    currentTime = 0.1;
    vi.advanceTimersByTime(25);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(0.2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns a handle that cancels pending callbacks", () => {
    const scheduler = new Scheduler(context);
    const callback = vi.fn();

    const handle = scheduler.schedule(callback, 0.2);
    handle.cancel();
    currentTime = 0.2;
    vi.advanceTimersByTime(25);

    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispatches multiple callbacks in context-time order", () => {
    const scheduler = new Scheduler(context);
    const calls: number[] = [];
    scheduler.schedule((at) => calls.push(at), 0.08);
    scheduler.schedule((at) => calls.push(at), 0.04);

    vi.advanceTimersByTime(25);

    expect(calls).toEqual([0.04, 0.08]);
  });
});
