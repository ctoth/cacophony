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
  createInterface: () => ({
    close: mocks.closeReadline,
    prompt: mocks.prompt,
    async *[Symbol.asyncIterator]() {
      yield "param 0 frequency 800 over 1000";
      yield "exit";
    },
  }),
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
