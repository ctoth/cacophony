import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rampFilterParam = vi.fn();
  const close = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const prompt = vi.fn();
  const closeReadline = vi.fn();
  const filterNode = {};
  const bus = {
    filters: [filterNode],
    rampFilterParam,
  };

  return {
    bus,
    close,
    closeReadline,
    filterNode,
    prompt,
    rampFilterParam,
  };
});

vi.mock("node:readline/promises", () => ({
  createInterface: () => {
    const lineCbs: Array<(line: string) => void> = [];
    const closeCbs: Array<() => void> = [];
    // Deliver the scripted lines via `line` events (then `close`), matching the
    // event-driven loop in runRepl, once its listeners are attached.
    queueMicrotask(() => {
      for (const cb of lineCbs) cb("param 0 frequency 800 over 1000");
      for (const cb of lineCbs) cb("exit");
      for (const cb of closeCbs) cb();
    });
    return {
      close: mocks.closeReadline,
      prompt: mocks.prompt,
      on(event: string, cb: (line: string) => void): void {
        if (event === "line") lineCbs.push(cb);
        else if (event === "close") closeCbs.push(cb as () => void);
      },
    };
  },
}));

vi.mock("../node", () => ({
  createNodeCacophony: () => ({
    cacophony: {},
    context: { close: mocks.close },
  }),
}));

vi.mock("./session", () => ({
  DEFAULT_FX_BUS: "fx",
  Session: class {
    commandLog(): [] {
      return [];
    }

    record(): void {}

    resolveBus(): typeof mocks.bus {
      return mocks.bus;
    }

    scratchBus(): typeof mocks.bus {
      return mocks.bus;
    }
  },
}));

describe("runRepl", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes `param ... over <ms>` ramp durations through in milliseconds", async () => {
    const { runRepl } = await import("./repl");

    await runRepl();

    expect(mocks.rampFilterParam).toHaveBeenCalledWith(mocks.filterNode, "frequency", 800, { duration: 1000 });
  });
});
