import { beforeEach, describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "./eventEmitter";

// Test event interface
interface TestEvents {
  testEvent: string;
  numberEvent: number;
  objectEvent: { value: number };
  voidEvent: undefined;
}

describe("TypedEventEmitter", () => {
  let emitter: TypedEventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new TypedEventEmitter<TestEvents>();
  });

  describe("Basic functionality", () => {
    it("should register and emit events", () => {
      const listener = vi.fn();
      emitter.on("testEvent", listener);
      emitter.emit("testEvent", "hello");

      expect(listener).toHaveBeenCalledWith("hello");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should support multiple listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on("testEvent", listener1);
      emitter.on("testEvent", listener2);
      emitter.emit("testEvent", "hello");

      expect(listener1).toHaveBeenCalledWith("hello");
      expect(listener2).toHaveBeenCalledWith("hello");
    });

    it("should handle different event types", () => {
      const stringListener = vi.fn();
      const numberListener = vi.fn();
      const objectListener = vi.fn();
      const voidListener = vi.fn();

      emitter.on("testEvent", stringListener);
      emitter.on("numberEvent", numberListener);
      emitter.on("objectEvent", objectListener);
      emitter.on("voidEvent", voidListener);

      emitter.emit("testEvent", "test");
      emitter.emit("numberEvent", 42);
      emitter.emit("objectEvent", { value: 100 });
      emitter.emit("voidEvent", undefined);

      expect(stringListener).toHaveBeenCalledWith("test");
      expect(numberListener).toHaveBeenCalledWith(42);
      expect(objectListener).toHaveBeenCalledWith({ value: 100 });
      expect(voidListener).toHaveBeenCalledWith(undefined);
    });
  });

  describe("once", () => {
    it("should register one-time listeners", () => {
      const listener = vi.fn();
      emitter.once("testEvent", listener);

      emitter.emit("testEvent", "first");
      emitter.emit("testEvent", "second");

      expect(listener).toHaveBeenCalledWith("first");
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should return unsubscribe function", () => {
      const listener = vi.fn();
      const unsubscribe = emitter.once("testEvent", listener);

      unsubscribe();
      emitter.emit("testEvent", "test");

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("off", () => {
    it("should remove specific listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on("testEvent", listener1);
      emitter.on("testEvent", listener2);
      emitter.off("testEvent", listener1);
      emitter.emit("testEvent", "test");

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledWith("test");
    });

    it("should handle removing non-existent listeners", () => {
      const listener = vi.fn();

      expect(() => {
        emitter.off("testEvent", listener);
      }).not.toThrow();
    });
  });

  describe("emitAsync", () => {
    it("should handle async listeners", async () => {
      const asyncListener = vi.fn().mockResolvedValue(undefined);
      emitter.on("testEvent", asyncListener);

      await emitter.emitAsync("testEvent", "async");

      expect(asyncListener).toHaveBeenCalledWith("async");
    });

    it("should handle listener errors gracefully", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const errorListener = vi.fn().mockRejectedValue(new Error("test error"));
      const successListener = vi.fn().mockResolvedValue(undefined);

      emitter.on("testEvent", errorListener);
      emitter.on("testEvent", successListener);

      await emitter.emitAsync("testEvent", "test");

      expect(errorListener).toHaveBeenCalledWith("test");
      expect(successListener).toHaveBeenCalledWith("test");
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it("should handle once listeners with async emit", async () => {
      const onceListener = vi.fn().mockResolvedValue(undefined);
      const regularListener = vi.fn().mockResolvedValue(undefined);

      emitter.once("testEvent", onceListener);
      emitter.on("testEvent", regularListener);

      await emitter.emitAsync("testEvent", "first");
      await emitter.emitAsync("testEvent", "second");

      expect(onceListener).toHaveBeenCalledWith("first");
      expect(onceListener).toHaveBeenCalledTimes(1);
      expect(regularListener).toHaveBeenCalledTimes(2);
    });

    it("should return undefined when no listeners", async () => {
      const result = await emitter.emitAsync("testEvent", "test");
      expect(result).toBeUndefined();
    });

    it("should handle mixed sync and async listeners", async () => {
      const syncListener = vi.fn();
      const asyncListener = vi.fn().mockResolvedValue(undefined);

      emitter.on("testEvent", syncListener);
      emitter.on("testEvent", asyncListener);

      await emitter.emitAsync("testEvent", "test");

      expect(syncListener).toHaveBeenCalledWith("test");
      expect(asyncListener).toHaveBeenCalledWith("test");
    });
  });

  describe("removeAllListeners", () => {
    it("should remove all listeners", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      emitter.on("testEvent", listener1);
      emitter.on("numberEvent", listener2);
      emitter.removeAllListeners();

      emitter.emit("testEvent", "test");
      emitter.emit("numberEvent", 42);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribe functionality", () => {
    it("should return unsubscribe function from on()", () => {
      const listener = vi.fn();
      const unsubscribe = emitter.on("testEvent", listener);

      unsubscribe();
      emitter.emit("testEvent", "test");

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // Regression tests for the re-entrancy + once-removal race fixed by the
  // snapshot-and-remove-against-current-state rework. See
  // reports/ts-review-eventEmitter.md (Blockers 4 & 5) and the workaround in
  // src/sound.ts emitGlobalEvent that motivated this fix.
  describe("re-entrancy and concurrent mutation", () => {
    it("emit honours off() called from inside a sibling listener (during emit)", () => {
      // Scenario (a): listener1 calls off(listener2) while emit is iterating.
      // The pre-fix code rebuilt this.listeners[event] from the pre-emit
      // snapshot, silently resurrecting listener2 for the NEXT emit.
      const listener2 = vi.fn();
      emitter.on("testEvent", () => {
        emitter.off("testEvent", listener2);
      });
      emitter.on("testEvent", listener2);

      emitter.emit("testEvent", "first");
      // listener2 was registered when emit started, so it still fires this turn.
      expect(listener2).toHaveBeenCalledTimes(1);

      emitter.emit("testEvent", "second");
      // After the first emit, listener2 must remain removed.
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("once removal does not resurrect a sibling off()'d from inside a listener", () => {
      // Scenario (b): a once listener fires while a regular listener calls
      // off(sibling). The pre-fix code's filter-and-reassign overwrote the
      // sibling removal because it filtered the pre-emit snapshot.
      const onceFn = vi.fn();
      const siblingFn = vi.fn();
      emitter.once("testEvent", onceFn);
      emitter.on("testEvent", () => {
        emitter.off("testEvent", siblingFn);
      });
      emitter.on("testEvent", siblingFn);

      emitter.emit("testEvent", "first");
      // First emit: all three listeners are present, all fire.
      expect(onceFn).toHaveBeenCalledTimes(1);
      expect(siblingFn).toHaveBeenCalledTimes(1);

      emitter.emit("testEvent", "second");
      // Second emit: onceFn must be gone (it was `once`), siblingFn must be
      // gone (the in-listener off() must have stuck), only the middle
      // listener remains. siblingFn count unchanged.
      expect(onceFn).toHaveBeenCalledTimes(1);
      expect(siblingFn).toHaveBeenCalledTimes(1);
    });

    it("re-entrant emit does not re-fire a once listener", () => {
      // The pre-fix code removed once listeners only AFTER the loop, so a
      // listener that synchronously re-emitted the same event would re-fire
      // the still-present once listener.
      const onceFn = vi.fn();
      let reentered = false;
      emitter.once("testEvent", onceFn);
      emitter.on("testEvent", () => {
        if (!reentered) {
          reentered = true;
          emitter.emit("testEvent", "reentrant");
        }
      });

      emitter.emit("testEvent", "outer");
      // `once` means once across the whole program lifetime. The fix
      // removes once listeners from storage BEFORE iterating the dispatch
      // snapshot, so the re-entrant emit cannot see (and re-fire) onceFn.
      expect(onceFn).toHaveBeenCalledTimes(1);
    });

    it("emitAsync honours off() called from inside a sibling listener", async () => {
      // Scenario (c): emitAsync variant of scenario (a).
      const listener2 = vi.fn().mockResolvedValue(undefined);
      emitter.on("testEvent", () => {
        emitter.off("testEvent", listener2);
      });
      emitter.on("testEvent", listener2);

      await emitter.emitAsync("testEvent", "first");
      expect(listener2).toHaveBeenCalledTimes(1);

      await emitter.emitAsync("testEvent", "second");
      // listener2 must stay removed across emits.
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("once cleanup is idempotent after auto-removal", () => {
      // The unsub returned from once() must be safe to call after the
      // listener has already self-removed by firing.
      const listener = vi.fn();
      const unsub = emitter.once("testEvent", listener);

      emitter.emit("testEvent", "fires");
      expect(listener).toHaveBeenCalledTimes(1);

      // Now call the unsub — must be a no-op, not throw, not double-remove.
      expect(() => unsub()).not.toThrow();

      emitter.emit("testEvent", "no-fire");
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
