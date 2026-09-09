import { expect, it, vi } from "vitest";
import { Cacophony } from "./cacophony";
import { audioContextMock, cacophony } from "./setupTests";

it("resolves a deferred worklet URL only when registering and reuses registration", async () => {
  const addModule = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(audioContextMock, "audioWorklet", { configurable: true, value: { addModule } });
  const loadUrl = vi.fn().mockResolvedValue("data:text/javascript,registerProcessor()");
  const worklet = { name: "lazy-test", url: loadUrl };

  await cacophony.buildWorkletEffect(worklet, {});
  await cacophony.buildWorkletEffect(worklet, {});

  expect(loadUrl).toHaveBeenCalledTimes(1);
  expect(addModule).toHaveBeenCalledExactlyOnceWith("data:text/javascript,registerProcessor()", {
    credentials: "same-origin",
  });
});

it("retries a rejected URL loader and passes a string to the runtime resolver", async () => {
  const addModule = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(audioContextMock, "audioWorklet", { configurable: true, value: { addModule } });
  const resolveWorkletUrl = vi.fn().mockResolvedValue("blob:remapped");
  const audio = new Cacophony(audioContextMock, undefined, { autoUnlock: false, resolveWorkletUrl });
  const loadUrl = vi
    .fn()
    .mockRejectedValueOnce(new Error("chunk unavailable"))
    .mockResolvedValue("data:text/javascript,test");
  const worklet = { name: "retry-test", url: loadUrl };

  await expect(audio.buildWorkletEffect(worklet, {})).rejects.toThrow("chunk unavailable");
  expect(addModule).not.toHaveBeenCalled();
  await audio.buildWorkletEffect(worklet, {});
  expect(loadUrl).toHaveBeenCalledTimes(2);
  expect(resolveWorkletUrl).toHaveBeenCalledExactlyOnceWith("retry-test", "data:text/javascript,test");
  expect(addModule).toHaveBeenCalledExactlyOnceWith("blob:remapped", { credentials: "same-origin" });
});

it("does not register or construct a node after cancellation during URL loading", async () => {
  const addModule = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(audioContextMock, "audioWorklet", { configurable: true, value: { addModule } });
  const createAudioWorkletNode = vi.fn(() => {
    throw new Error("not registered");
  });
  const audio = new Cacophony(audioContextMock, undefined, { autoUnlock: false, quiet: true, createAudioWorkletNode });
  let release!: (url: string) => void;
  const ready = new Promise<string>((resolve) => {
    release = resolve;
  });
  const loadUrl = vi.fn(() => ready);
  const controller = new AbortController();
  const pending = audio.createWorkletNode("cancel-test", loadUrl, controller.signal);
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(loadUrl).toHaveBeenCalledTimes(1);
  controller.abort();
  release("data:text/javascript,test");
  await rejection;
  expect(addModule).not.toHaveBeenCalled();
  expect(createAudioWorkletNode).toHaveBeenCalledTimes(1);
});
