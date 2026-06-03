import { beforeEach, describe, expect, it, vi } from "vitest";

import { Cacophony } from "./cacophony";
import type { CacophonyLogger } from "./logger";
import { audioContextMock, mockCache } from "./setupTests";

/**
 * Returns a `createAudioWorkletNode` factory that always succeeds, yielding a
 * minimal fake worklet node. With this injected, `createWorkletNode` takes the
 * first-attempt success path and emits exactly one host-side
 * `[cacophony/worklet] construct succeeded` info log via the resolved logger —
 * the smallest path that produces a `[cacophony/worklet]` message under the
 * mock context.
 */
const succeedingWorkletFactory = () =>
  vi.fn(
    () =>
      ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        port: {
          postMessage: vi.fn(),
          addEventListener: vi.fn(),
        },
      }) as any,
  );

describe("logging seam (CacophonyLogger + quiet)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("quiet: true suppresses host worklet logs (no console.info)", async () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const instance = new Cacophony(audioContextMock, mockCache, {
      quiet: true,
      createAudioWorkletNode: succeedingWorkletFactory(),
    });

    await instance.createWorkletNode("test-worklet", "https://example.com/worklet.js");

    expect(consoleInfoSpy).not.toHaveBeenCalledWith("[cacophony/worklet] construct succeeded", expect.anything());

    consoleInfoSpy.mockRestore();
  });

  it("custom logger receives the host worklet log instead of console", async () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const logger: CacophonyLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const instance = new Cacophony(audioContextMock, mockCache, {
      logger,
      createAudioWorkletNode: succeedingWorkletFactory(),
    });

    await instance.createWorkletNode("test-worklet", "https://example.com/worklet.js");

    expect(logger.info).toHaveBeenCalledWith(
      "[cacophony/worklet] construct succeeded",
      expect.objectContaining({ name: "test-worklet" }),
    );
    expect(consoleInfoSpy).not.toHaveBeenCalledWith("[cacophony/worklet] construct succeeded", expect.anything());

    consoleInfoSpy.mockRestore();
  });

  it("default (no logger/quiet) still logs to console", async () => {
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const instance = new Cacophony(audioContextMock, mockCache, {
      createAudioWorkletNode: succeedingWorkletFactory(),
    });

    await instance.createWorkletNode("test-worklet", "https://example.com/worklet.js");

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[cacophony/worklet] construct succeeded",
      expect.objectContaining({ name: "test-worklet" }),
    );

    consoleInfoSpy.mockRestore();
  });

  it("logger takes precedence over quiet when both are provided", async () => {
    const logger: CacophonyLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const instance = new Cacophony(audioContextMock, mockCache, {
      logger,
      quiet: true,
      createAudioWorkletNode: succeedingWorkletFactory(),
    });

    await instance.createWorkletNode("test-worklet", "https://example.com/worklet.js");

    expect(logger.info).toHaveBeenCalledWith(
      "[cacophony/worklet] construct succeeded",
      expect.objectContaining({ name: "test-worklet" }),
    );
  });
});
