import { describe, expect, it, vi } from "vitest";
import { registerEffectProcessor } from "./processors/register-effect";
import { cacophony } from "./setupTests";

describe("owned worklet retirement", () => {
  it("retires removed effects, preserves bypassed effects, and retires survivors on destroy", async () => {
    vi.spyOn(cacophony, "buildWorkletEffect").mockImplementation(
      async () =>
        ({
          connect: vi.fn(),
          disconnect: vi.fn(),
          port: { postMessage: vi.fn() },
        }) as never,
    );
    const bus = cacophony.createBus("retirement");
    const first = await bus.addFilter(cacophony.createFdnReverb());
    const second = await bus.addFilter(cacophony.createDelay());
    const post = (node: typeof first) =>
      (node as unknown as { port: { postMessage: ReturnType<typeof vi.fn> } }).port.postMessage;
    bus.setFilterBypassed(first, true);
    bus.setFilterBypassed(first, false);
    expect(post(first)).not.toHaveBeenCalled();
    bus.removeFilter(first);
    expect(post(first)).toHaveBeenCalledExactlyOnceWith("cacophony:dispose");
    expect(post(second)).not.toHaveBeenCalled();
    bus.destroy();
    expect(post(first)).toHaveBeenCalledTimes(1);
    expect(post(second)).toHaveBeenCalledExactlyOnceWith("cacophony:dispose");
  });

  it("retires an effect that finishes building after its owner was destroyed", async () => {
    let finish!: (node: never) => void;
    vi.spyOn(cacophony, "buildWorkletEffect").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const bus = cacophony.createBus("late-retirement");
    const pending = bus.addFilter(cacophony.createFdnReverb());
    bus.destroy();
    const node = { connect: vi.fn(), disconnect: vi.fn(), port: { postMessage: vi.fn() } };
    finish(node as never);
    await pending;
    expect(node.port.postMessage).toHaveBeenCalledExactlyOnceWith("cacophony:dispose");
    expect(node.disconnect).toHaveBeenCalled();
  });

  it("returns false without running DSP after the terminal message", () => {
    const register = vi.fn();
    vi.stubGlobal("registerProcessor", register);
    const process = vi.fn(() => true);
    const close = vi.fn();
    let receive!: (event: { data: unknown }) => void;
    class Processor {
      static get parameterDescriptors() {
        return [{ name: "mix", defaultValue: 1 }];
      }
      port = {
        addEventListener: (_: string, listener: typeof receive) => {
          receive = listener;
        },
        start: vi.fn(),
        postMessage: vi.fn(),
        close,
      };
      process(...args: unknown[]) {
        return process(...args);
      }
    }
    registerEffectProcessor("test-owned", Processor as unknown as AudioWorkletProcessorConstructor);
    const Owned = register.mock.calls[0][1];
    expect(Owned.parameterDescriptors).toEqual(Processor.parameterDescriptors);
    const shell = new Owned();
    expect(shell.process([], [], {})).toBe(true);
    receive({ data: "unrelated" });
    expect(shell.process([], [], {})).toBe(true);
    receive({ data: "cacophony:dispose" });
    expect(shell.process([], [], {})).toBe(false);
    expect(shell.process([], [], {})).toBe(false);
    expect(process).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
