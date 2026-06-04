import { afterEach, describe, expect, it, vi } from "vitest";

type EndedListener = () => void;

const mocks = vi.hoisted(() => {
  const close = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const playbackListeners: EndedListener[][] = [[], []];
  const playbacks = playbackListeners.map((listeners) => ({
    on: vi.fn((event: "ended", listener: EndedListener) => {
      if (event === "ended") listeners.push(listener);
      return () => {};
    }),
  }));
  const play = vi.fn(() => playbacks);

  return {
    close,
    play,
    playbackListeners,
    playbacks,
  };
});

vi.mock("../node", () => ({
  createNodeCacophony: () => ({
    cacophony: {},
    context: { close: mocks.close },
  }),
}));

vi.mock("./commands", () => ({
  applyPitchAfterPlay: vi.fn(),
  buildFxBus: vi.fn(),
  buildGroup: vi.fn(() =>
    Promise.resolve({
      group: { play: mocks.play },
      play: mocks.play,
    }),
  ),
  buildSource: vi.fn(),
}));

describe("runLive", () => {
  afterEach(() => {
    vi.clearAllMocks();
    for (const listeners of mocks.playbackListeners) listeners.length = 0;
  });

  it("watches every group playback for natural end shutdown", async () => {
    const { runLive } = await import("./live");
    const livePromise = runLive({ source: "a.wav", groupSources: ["b.wav"] });

    await Promise.resolve();

    try {
      expect(mocks.play).toHaveBeenCalledTimes(1);
      expect(mocks.playbacks[0].on).toHaveBeenCalledWith("ended", expect.any(Function));
      expect(mocks.playbacks[1].on).toHaveBeenCalledWith("ended", expect.any(Function));
      mocks.playbackListeners[0][0]?.();
      expect(mocks.close).not.toHaveBeenCalled();
      mocks.playbackListeners[1][0]?.();
      await livePromise;
      expect(mocks.close).toHaveBeenCalledTimes(1);
    } finally {
      if (mocks.close.mock.calls.length === 0) {
        process.emit("SIGINT", "SIGINT");
        await livePromise;
      }
    }
  });
});
