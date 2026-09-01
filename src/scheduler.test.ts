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

  it("dispatches entries already inside the lookahead window immediately", () => {
    const scheduler = new Scheduler(context);
    const callback = vi.fn();

    scheduler.schedule(callback, 0.05);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(0.05);
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
    scheduler.schedule((at) => calls.push(at), 0.18);
    scheduler.schedule((at) => calls.push(at), 0.14);

    currentTime = 0.08;
    vi.advanceTimersByTime(25);

    expect(calls).toEqual([0.14, 0.18]);
  });

  it("dispatches every due entry when one callback throws", () => {
    const scheduler = new Scheduler(context);
    const error = new Error("callback failed");
    const second = vi.fn();
    scheduler.schedule(() => {
      throw error;
    }, 0.2);
    scheduler.schedule(second, 0.21);

    currentTime = 0.11;

    expect(() => vi.advanceTimersByTime(25)).toThrow(error);
    expect(second).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledWith(0.21);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets a due callback cancel another due callback before it is invoked", () => {
    const scheduler = new Scheduler(context);
    const second = vi.fn();
    let secondHandle: ReturnType<Scheduler["schedule"]>;
    scheduler.schedule(() => secondHandle.cancel(), 0.2);
    secondHandle = scheduler.schedule(second, 0.21);

    currentTime = 0.11;
    vi.advanceTimersByTime(25);

    expect(second).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
