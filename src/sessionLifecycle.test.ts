import { AudioContext } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cacophony, type RuntimeOptions } from "./cacophony";
import { mockCache } from "./setupTests";

describe("audio session lifecycle", () => {
  let doc: EventTarget & { visibilityState: string; body: EventTarget };
  let host: EventTarget;
  let media: EventTarget & { enumerateDevices: ReturnType<typeof vi.fn> };
  let context: AudioContext;
  let state: string;
  let instance: Cacophony;

  const transition = (next: string) => {
    state = next;
    context.dispatchEvent(new Event("statechange"));
  };
  const create = (options: RuntimeOptions = {}) => {
    instance = new Cacophony(context as any, mockCache, { autoUnlock: false, quiet: true, ...options });
    return instance;
  };

  beforeEach(() => {
    doc = Object.assign(new EventTarget(), { visibilityState: "visible", body: new EventTarget() });
    host = new EventTarget();
    media = Object.assign(new EventTarget(), { enumerateDevices: vi.fn().mockResolvedValue([]) });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", host);
    vi.stubGlobal("navigator", { mediaDevices: media });
    context = new AudioContext();
    state = "running";
    Object.defineProperty(context, "state", { get: () => state });
    vi.spyOn(context, "resume").mockResolvedValue(undefined);
  });

  afterEach(() => {
    instance?.dispose();
    vi.unstubAllGlobals();
  });

  it("emits each platform state transition once", () => {
    create();
    const events: string[] = [];
    for (const name of ["suspend", "resume", "interrupted"] as const)
      instance.on(name, () => {
        events.push(name);
      });
    transition("suspended");
    transition("suspended");
    transition("interrupted");
    transition("running");
    transition("running");
    expect(events).toEqual(["suspend", "interrupted", "resume"]);
  });

  it("blocks recovery before a user suspension completes and deduplicates explicit events", async () => {
    create();
    const suspend = vi.fn(async () => {
      transition("suspended");
    });
    Object.defineProperty(context, "suspend", { value: suspend });
    const onSuspend = vi.fn();
    const onResume = vi.fn();
    instance.on("suspend", onSuspend);
    instance.on("resume", onResume);
    await instance.pause();
    expect(context.resume).not.toHaveBeenCalled();
    host.dispatchEvent(new Event("focus"));
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(context.resume).not.toHaveBeenCalled();
    vi.mocked(context.resume).mockImplementation(async () => {
      transition("running");
    });
    await instance.resume();
    transition("running");
    expect(onSuspend).toHaveBeenCalledOnce();
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("retains gesture fallback without allowing a gesture to undo user pause", async () => {
    create({ autoUnlock: true });
    Object.defineProperty(context, "suspend", {
      value: vi.fn(async () => {
        transition("suspended");
      }),
    });
    await instance.pause();
    doc.body.dispatchEvent(new Event("click"));
    expect(context.resume).not.toHaveBeenCalled();
  });

  it("restores user pause after a pending gesture unlock with session recovery disabled", async () => {
    state = "suspended";
    create({ autoUnlock: true, autoRecover: false });
    let finish!: () => void;
    vi.mocked(context.resume).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const suspend = vi.fn(async () => {
      transition("suspended");
    });
    Object.defineProperty(context, "suspend", { value: suspend });
    const unlock = vi.fn();
    instance.on("unlock", unlock);
    doc.body.dispatchEvent(new Event("click"));
    await instance.pause();
    state = "running";
    finish();
    await Promise.resolve();
    expect(suspend).toHaveBeenCalledTimes(2);
    expect(state).toBe("suspended");
    expect(unlock).not.toHaveBeenCalled();
  });

  it("restores recovery eligibility after a rejected user pause", async () => {
    create();
    const error = new Error("suspend failed");
    Object.defineProperty(context, "suspend", { value: vi.fn().mockRejectedValue(error) });
    await expect(instance.pause()).rejects.toBe(error);
    transition("interrupted");
    expect(context.resume).toHaveBeenCalledOnce();
  });

  it("restores a user pause if an earlier automatic resume finishes late", async () => {
    create();
    let finish!: () => void;
    vi.mocked(context.resume).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const suspend = vi.fn(async () => {
      transition("suspended");
    });
    Object.defineProperty(context, "suspend", { value: suspend });
    transition("interrupted");
    await instance.pause();
    // Native state changes can precede their queued statechange event.
    state = "running";
    finish();
    await Promise.resolve();
    expect(suspend).toHaveBeenCalledTimes(2);
    expect(state).toBe("suspended");
  });

  it("does not emit a successful resume while the context remains interrupted", async () => {
    state = "interrupted";
    create();
    const listener = vi.fn();
    instance.on("resume", listener);
    await instance.resume();
    expect(listener).not.toHaveBeenCalled();
  });

  it("preserves user pause after a rejected explicit resume", async () => {
    create();
    Object.defineProperty(context, "suspend", {
      value: vi.fn(async () => {
        transition("suspended");
      }),
    });
    await instance.pause();
    const error = new Error("resume failed");
    vi.mocked(context.resume).mockRejectedValue(error);
    await expect(instance.resume()).rejects.toBe(error);
    host.dispatchEvent(new Event("focus"));
    expect(context.resume).toHaveBeenCalledOnce();
  });

  it("keeps a newer pause when an older explicit resume rejects", async () => {
    create();
    let rejectResume!: (error: Error) => void;
    vi.mocked(context.resume).mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectResume = reject;
      }),
    );
    const pending = instance.resume();
    Object.defineProperty(context, "suspend", {
      value: vi.fn(async () => {
        transition("suspended");
      }),
    });
    await instance.pause();
    const error = new Error("old resume failed");
    rejectResume(error);
    await expect(pending).rejects.toBe(error);
    host.dispatchEvent(new Event("focus"));
    expect(context.resume).toHaveBeenCalledOnce();
  });

  it("retries on foreground signals only while visible and coalesces pending attempts", async () => {
    doc.visibilityState = "hidden";
    create();
    transition("suspended");
    host.dispatchEvent(new Event("pageshow"));
    expect(context.resume).not.toHaveBeenCalled();
    let finish!: () => void;
    vi.mocked(context.resume).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    host.dispatchEvent(new Event("focus"));
    host.dispatchEvent(new Event("pageshow"));
    expect(context.resume).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    host.dispatchEvent(new Event("focus"));
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it("logs failed recovery and waits for another foreground signal", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    create({ logger });
    const error = new Error("gesture required");
    vi.mocked(context.resume).mockRejectedValue(error);
    transition("interrupted");
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), error);
    expect(context.resume).toHaveBeenCalledOnce();
    host.dispatchEvent(new Event("pageshow"));
    expect(context.resume).toHaveBeenCalledTimes(2);
  });

  it("emits only audio outputs on device-list changes", async () => {
    create();
    const speaker = { kind: "audiooutput", deviceId: "speaker" };
    media.enumerateDevices.mockResolvedValue([speaker, { kind: "audioinput" }, { kind: "videoinput" }]);
    const listener = vi.fn();
    instance.on("devicechange", listener);
    media.dispatchEvent(new Event("devicechange"));
    await Promise.resolve();
    expect(listener).toHaveBeenCalledExactlyOnceWith({ devices: [speaker], timestamp: expect.any(Number) });
  });

  it("does not publish an older device inventory after a newer change", async () => {
    create();
    let finishOld!: (devices: unknown[]) => void;
    media.enumerateDevices.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
    const listener = vi.fn();
    instance.on("devicechange", listener);
    media.dispatchEvent(new Event("devicechange"));
    media.dispatchEvent(new Event("devicechange"));
    await Promise.resolve();
    finishOld([{ kind: "audiooutput", deviceId: "removed" }]);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledExactlyOnceWith({ devices: [], timestamp: expect.any(Number) });
  });

  it("logs enumeration rejection without emitting a misleading empty inventory", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    create({ logger });
    const error = new Error("enumeration denied");
    media.enumerateDevices.mockRejectedValue(error);
    const listener = vi.fn();
    instance.on("devicechange", listener);
    media.dispatchEvent(new Event("devicechange"));
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), error);
  });

  it("observes contexts without a mediaDevices capability", () => {
    vi.stubGlobal("navigator", {});
    create();
    const listener = vi.fn();
    instance.on("interrupted", listener);
    transition("interrupted");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("removes session, sink, and gesture listeners when the browser context closes", () => {
    create({ autoUnlock: true });
    const remove = vi.spyOn(context, "removeEventListener");
    const docRemove = vi.spyOn(doc, "removeEventListener");
    transition("closed");
    expect(remove.mock.calls.filter(([name]) => name === "statechange")).toHaveLength(2);
    expect(remove).toHaveBeenCalledWith("sinkchange", expect.any(Function));
    expect(docRemove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    transition("interrupted");
    expect(context.resume).not.toHaveBeenCalled();
  });

  it("disposes all listeners and suppresses late asynchronous device results", async () => {
    create();
    const contextRemove = vi.spyOn(context, "removeEventListener");
    const docRemove = vi.spyOn(doc, "removeEventListener");
    const hostRemove = vi.spyOn(host, "removeEventListener");
    const mediaRemove = vi.spyOn(media, "removeEventListener");
    const listener = vi.fn();
    instance.on("devicechange", listener);
    media.dispatchEvent(new Event("devicechange"));
    instance.dispose();
    await Promise.resolve();
    transition("suspended");
    expect(listener).not.toHaveBeenCalled();
    expect(context.resume).not.toHaveBeenCalled();
    expect(contextRemove).toHaveBeenCalledWith("statechange", expect.any(Function));
    expect(docRemove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    for (const name of ["focus", "pageshow"]) expect(hostRemove).toHaveBeenCalledWith(name, expect.any(Function));
    expect(mediaRemove).toHaveBeenCalledWith("devicechange", expect.any(Function));
  });

  it.each(["opt-out", "offline", "no document", "no navigator"])("skips installation: %s", (mode) => {
    if (mode === "offline") Object.assign(context, { startRendering: vi.fn() });
    if (mode === "no document") vi.stubGlobal("document", undefined);
    if (mode === "no navigator") vi.stubGlobal("navigator", undefined);
    const add = vi.spyOn(context, "addEventListener");
    create({ autoRecover: mode !== "opt-out" });
    expect(add.mock.calls.filter(([name]) => name === "statechange")).toHaveLength(0);
    transition("interrupted");
    expect(context.resume).not.toHaveBeenCalled();
  });
});
