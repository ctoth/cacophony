import { describe, expect, it, vi } from "vitest";
import { Cacophony } from "./cacophony";
import { audioContextMock, cacophony, mockCache } from "./setupTests";

describe("output devices", () => {
  it.each(["", "headphones", { type: "none" } as const])("delegates the exact sink %j", async (sinkId) => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(audioContextMock, "setSinkId", { value: setSinkId });
    await cacophony.setOutputDevice(sinkId);
    expect(setSinkId).toHaveBeenCalledExactlyOnceWith(sinkId);
    expect(setSinkId.mock.contexts[0]).toBe(audioContextMock);
  });

  it("rejects unsupported contexts and reports no output device", async () => {
    expect(cacophony.outputDevice).toBeUndefined();
    await expect(cacophony.setOutputDevice("speaker")).rejects.toThrow("Output device selection is not supported");
  });

  it.each(["NotAllowedError", "NotFoundError"])("preserves the platform %s", async (name) => {
    const error = new DOMException("Output unavailable", name);
    Object.defineProperty(audioContextMock, "setSinkId", { value: vi.fn().mockRejectedValue(error) });
    await expect(cacophony.setOutputDevice("speaker")).rejects.toBe(error);
  });

  it("reads the current sink and forwards native changes, including third-party changes", () => {
    let sinkId: string | { type: "none" } = "";
    Object.defineProperty(audioContextMock, "sinkId", { get: () => sinkId });
    const listener = vi.fn();
    cacophony.on("sinkChange", listener);
    expect(cacophony.outputDevice).toBe("");
    sinkId = { type: "none" };
    audioContextMock.dispatchEvent(new Event("sinkchange"));
    expect(cacophony.outputDevice).toBe(sinkId);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ sinkId });
  });

  it("removes sink listeners on disposal", () => {
    Object.defineProperty(audioContextMock, "sinkId", { value: "" });
    const remove = vi.spyOn(audioContextMock, "removeEventListener");
    const listener = vi.fn();
    cacophony.on("sinkChange", listener);
    cacophony.dispose();
    cacophony.dispose();
    audioContextMock.dispatchEvent(new Event("sinkchange"));
    expect(listener).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("sinkchange", expect.any(Function));
  });

  it("does not select or observe a sink on an offline context", async () => {
    const setSinkId = vi.fn();
    const context = Object.assign(audioContextMock, { startRendering: vi.fn(), setSinkId });
    const add = vi.spyOn(context, "addEventListener");
    const instance = new Cacophony(context as any, mockCache);
    await instance.setOutputDevice("speaker");
    expect(instance.outputDevice).toBeUndefined();
    expect(setSinkId).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });
});
