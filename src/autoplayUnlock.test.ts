import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Cacophony } from "./cacophony";
import type { BaseContext, AudioBuffer as CacophonyAudioBuffer } from "./context";
import { mockCache } from "./setupTests";

/**
 * Build an offline-context mock matching the pattern in offline.test.ts —
 * standardized-audio-context-mock's OfflineAudioContext is incomplete, so we
 * compose an online AudioContext with a startRendering method to satisfy
 * Cacophony.isOffline.
 */
function createOfflineContextMock(): BaseContext & { startRendering(): Promise<CacophonyAudioBuffer> } {
  const base = new AudioContext();
  const rendered = new AudioBuffer({ length: 128, sampleRate: 44100 });
  return Object.assign(base, {
    startRendering: vi.fn().mockResolvedValue(rendered),
    length: 128,
  }) as unknown as BaseContext & { startRendering(): Promise<CacophonyAudioBuffer> };
}

/**
 * Tests for autoplay unlock on first user gesture.
 *
 * The Cacophony constructor installs one-time touchend/click/keydown listeners
 * on document.body when the audio context starts in 'suspended' state. The
 * first fired gesture resumes the context, plays a silent primer buffer
 * (required for iOS Safari to truly unlock), removes the listeners, and emits
 * an `unlock` event.
 *
 * Vitest runs in node environment by default — `document` is undefined — so
 * each test that exercises the listener-install path mocks a minimal document
 * on `globalThis` and tears it down afterward.
 */

const UNLOCK_EVENTS = ["touchend", "click", "keydown"] as const;
type UnlockEvent = (typeof UNLOCK_EVENTS)[number];

interface MockDocument {
  body: MockEventTarget;
  addEventListenerSpy: ReturnType<typeof vi.fn>;
  removeEventListenerSpy: ReturnType<typeof vi.fn>;
  fire(event: UnlockEvent): void;
  listenersFor(event: UnlockEvent): Array<EventListenerOrEventListenerObject>;
}

interface MockEventTarget {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function installMockDocument(opts: { withBody?: boolean } = {}): MockDocument {
  const withBody = opts.withBody !== false;
  const listenerMap = new Map<UnlockEvent, Set<EventListenerOrEventListenerObject>>();

  const addEventListenerSpy = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    if (!UNLOCK_EVENTS.includes(type as UnlockEvent)) return;
    const set = listenerMap.get(type as UnlockEvent) ?? new Set();
    set.add(listener);
    listenerMap.set(type as UnlockEvent, set);
  });

  const removeEventListenerSpy = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    if (!UNLOCK_EVENTS.includes(type as UnlockEvent)) return;
    listenerMap.get(type as UnlockEvent)?.delete(listener);
  });

  const target: MockEventTarget = {
    addEventListener: addEventListenerSpy,
    removeEventListener: removeEventListenerSpy,
  };

  const mockDoc: any = withBody
    ? { body: target, addEventListener: addEventListenerSpy, removeEventListener: removeEventListenerSpy }
    : { addEventListener: addEventListenerSpy, removeEventListener: removeEventListenerSpy };

  (globalThis as any).document = mockDoc;

  return {
    body: target,
    addEventListenerSpy,
    removeEventListenerSpy,
    fire(event: UnlockEvent) {
      const listeners = listenerMap.get(event);
      if (!listeners) return;
      const ev = { type: event } as unknown as Event;
      for (const l of [...listeners]) {
        if (typeof l === "function") l.call(target, ev);
        else l.handleEvent(ev);
      }
    },
    listenersFor(event: UnlockEvent) {
      return [...(listenerMap.get(event) ?? [])];
    },
  };
}

function uninstallMockDocument(): void {
  delete (globalThis as any).document;
}

describe("Autoplay unlock", () => {
  let originalDocument: any;

  beforeEach(() => {
    originalDocument = (globalThis as any).document;
  });

  afterEach(() => {
    if (originalDocument === undefined) {
      delete (globalThis as any).document;
    } else {
      (globalThis as any).document = originalDocument;
    }
  });

  describe("listener installation", () => {
    it("installs touchend, click, and keydown listeners when context is suspended and autoUnlock is true", () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();
      // Mock starts suspended.
      expect(ctx.state).toBe("suspended");

      new Cacophony(ctx as any, mockCache);

      const types = doc.addEventListenerSpy.mock.calls.map((c) => c[0]);
      expect(types).toContain("touchend");
      expect(types).toContain("click");
      expect(types).toContain("keydown");
    });

    it("uses default autoUnlock=true when option is omitted", () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();
      new Cacophony(ctx as any, mockCache, {});
      expect(doc.addEventListenerSpy).toHaveBeenCalled();
    });

    it("does NOT install listeners when context.state is 'running'", async () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();
      await ctx.resume(); // state -> 'running'
      expect(ctx.state).toBe("running");

      new Cacophony(ctx as any, mockCache);

      expect(doc.addEventListenerSpy).not.toHaveBeenCalled();
    });

    it("does NOT install listeners when autoUnlock is false", () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();
      new Cacophony(ctx as any, mockCache, { autoUnlock: false });
      expect(doc.addEventListenerSpy).not.toHaveBeenCalled();
    });

    it("does NOT install listeners on an offline context", () => {
      const doc = installMockDocument();
      const offline = createOfflineContextMock();
      const c = new Cacophony(offline as any, mockCache);
      expect(c.isOffline).toBe(true);
      expect(doc.addEventListenerSpy).not.toHaveBeenCalled();
    });

    it("does NOT install listeners when document is undefined (non-browser env)", () => {
      uninstallMockDocument();
      const ctx = new AudioContext();
      // Should not throw.
      expect(() => new Cacophony(ctx as any, mockCache)).not.toThrow();
    });

    it("falls back to document when document.body is unavailable", () => {
      const doc = installMockDocument({ withBody: false });
      const ctx = new AudioContext();
      new Cacophony(ctx as any, mockCache);
      // addEventListenerSpy is the same fn for body and document in our mock,
      // so we just confirm it was called.
      expect(doc.addEventListenerSpy).toHaveBeenCalled();
    });
  });

  describe("unlock on gesture", () => {
    for (const eventName of UNLOCK_EVENTS) {
      it(`unlocks on '${eventName}': resume() called, primer played, listeners removed, unlock event emitted`, async () => {
        const doc = installMockDocument();
        const ctx = new AudioContext();
        const resumeSpy = vi.spyOn(ctx, "resume");
        const createBufferSpy = vi.spyOn(ctx, "createBuffer");
        const createBufferSourceSpy = vi.spyOn(ctx, "createBufferSource");

        const c = new Cacophony(ctx as any, mockCache);

        const unlockListener = vi.fn();
        c.on("unlock", unlockListener);

        doc.fire(eventName);

        // Allow any microtask the resume() promise produced to flush.
        await Promise.resolve();
        await Promise.resolve();

        expect(resumeSpy).toHaveBeenCalled();
        expect(createBufferSpy).toHaveBeenCalledWith(1, 1, ctx.sampleRate);
        expect(createBufferSourceSpy).toHaveBeenCalled();

        // All three listener types removed.
        const removedTypes = doc.removeEventListenerSpy.mock.calls.map((c) => c[0]);
        expect(removedTypes).toContain("touchend");
        expect(removedTypes).toContain("click");
        expect(removedTypes).toContain("keydown");

        expect(unlockListener).toHaveBeenCalledTimes(1);
      });
    }

    it("calls start(0) on the primer buffer source inside the gesture call stack", () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();

      const startSpy = vi.fn();
      const connectSpy = vi.fn();
      const sourceMock = {
        start: startSpy,
        stop: vi.fn(),
        connect: connectSpy,
        disconnect: vi.fn(),
        buffer: null,
      };
      vi.spyOn(ctx, "createBufferSource").mockReturnValue(sourceMock as any);

      new Cacophony(ctx as any, mockCache);

      doc.fire("click");

      expect(connectSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalledWith(0);
    });

    it("a second gesture after unlock does NOT re-fire (listeners are removed)", async () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();
      const c = new Cacophony(ctx as any, mockCache);

      const unlockListener = vi.fn();
      c.on("unlock", unlockListener);

      doc.fire("click");
      await Promise.resolve();
      expect(unlockListener).toHaveBeenCalledTimes(1);

      // After removal, no listeners should remain to dispatch into.
      expect(doc.listenersFor("click")).toHaveLength(0);
      expect(doc.listenersFor("touchend")).toHaveLength(0);
      expect(doc.listenersFor("keydown")).toHaveLength(0);

      doc.fire("click");
      doc.fire("touchend");
      doc.fire("keydown");
      await Promise.resolve();
      expect(unlockListener).toHaveBeenCalledTimes(1);
    });

    it("any one of the three gestures unlocks and removes ALL listeners", () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();
      new Cacophony(ctx as any, mockCache);

      // Fire only touchend.
      doc.fire("touchend");

      // All three listener types should be removed in one shot.
      const removedTypes = doc.removeEventListenerSpy.mock.calls.map((c) => c[0]);
      expect(new Set(removedTypes)).toEqual(new Set(["touchend", "click", "keydown"]));
    });
  });

  describe("resume contract", () => {
    it("does NOT emit unlock when context.resume() rejects", async () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();
      const rejectErr = new Error("resume failed");
      vi.spyOn(ctx, "resume").mockRejectedValue(rejectErr);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const c = new Cacophony(ctx as any, mockCache);
      const unlockListener = vi.fn();
      c.on("unlock", unlockListener);

      doc.fire("click");

      // Flush microtasks for the rejected promise to be observed.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(unlockListener).not.toHaveBeenCalled();
      expect(c.locked).toBe(true);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("emits unlock asynchronously, only after resume() fulfills", async () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();

      let resolveResume!: () => void;
      const resumePromise = new Promise<void>((resolve) => {
        resolveResume = resolve;
      });
      vi.spyOn(ctx, "resume").mockReturnValue(resumePromise as any);

      const c = new Cacophony(ctx as any, mockCache);
      const unlockListener = vi.fn();
      c.on("unlock", unlockListener);

      doc.fire("click");

      // After the synchronous gesture stack returns, unlock should not yet
      // have fired — resume() is still pending.
      await Promise.resolve();
      expect(unlockListener).not.toHaveBeenCalled();

      resolveResume();
      await Promise.resolve();
      await Promise.resolve();

      expect(unlockListener).toHaveBeenCalledTimes(1);
    });

    it("calls stop(0) on the primer buffer source after start(0)", () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();

      const startSpy = vi.fn();
      const stopSpy = vi.fn();
      const sourceMock = {
        start: startSpy,
        stop: stopSpy,
        connect: vi.fn(),
        disconnect: vi.fn(),
        buffer: null,
      };
      vi.spyOn(ctx, "createBufferSource").mockReturnValue(sourceMock as any);

      new Cacophony(ctx as any, mockCache);

      doc.fire("click");

      expect(startSpy).toHaveBeenCalledWith(0);
      expect(stopSpy).toHaveBeenCalledWith(0);
      // start must precede stop
      expect(startSpy.mock.invocationCallOrder[0]).toBeLessThan(stopSpy.mock.invocationCallOrder[0]);
    });
  });

  describe("locked getter", () => {
    it("returns true before unlock when context is suspended", () => {
      installMockDocument();
      const ctx = new AudioContext();
      const c = new Cacophony(ctx as any, mockCache);
      expect(c.locked).toBe(true);
    });

    it("returns false after unlock", async () => {
      const doc = installMockDocument();
      const ctx = new AudioContext();
      const c = new Cacophony(ctx as any, mockCache);
      expect(c.locked).toBe(true);

      doc.fire("click");
      await Promise.resolve();
      await Promise.resolve();

      expect(ctx.state).toBe("running");
      expect(c.locked).toBe(false);
    });

    it("returns false on a context that is already running", async () => {
      installMockDocument();
      const ctx = new AudioContext();
      await ctx.resume();
      const c = new Cacophony(ctx as any, mockCache);
      expect(c.locked).toBe(false);
    });
  });
});
