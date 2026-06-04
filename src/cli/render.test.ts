import { afterEach, describe, expect, it, vi } from "vitest";
import type { FxSpec } from "./commands";

const mocks = vi.hoisted(() => {
  const renderedBuffer = { length: 48000 };
  const startRendering = vi.fn<() => Promise<unknown>>(() => Promise.resolve(renderedBuffer));
  const context = { destination: {}, startRendering };
  const cacophony = {};
  const groupSounds = [{ id: "a" }, { id: "b" }];
  const group = {
    play: vi.fn(() => []),
    routeTo: vi.fn(),
    sounds: groupSounds,
  };
  const fxBus = {};
  const buildGroup = vi.fn(() => Promise.resolve({ group, play: group.play }));
  const buildFxBus = vi.fn(() => Promise.resolve({ bus: fxBus, nodes: [] }));
  const applyPitchAfterPlay = vi.fn(() => Promise.resolve());

  return {
    applyPitchAfterPlay,
    buildFxBus,
    buildGroup,
    cacophony,
    context,
    fxBus,
    group,
    groupSounds,
    renderedBuffer,
    startRendering,
  };
});

vi.mock("../node", () => ({
  createOfflineNodeCacophony: vi.fn(() => ({
    cacophony: mocks.cacophony,
    context: mocks.context,
  })),
  decodeAudioFile: vi.fn(),
}));

vi.mock("./commands", () => ({
  applyPitchAfterPlay: mocks.applyPitchAfterPlay,
  buildFoaSource: vi.fn(),
  buildFxBus: mocks.buildFxBus,
  buildGroup: mocks.buildGroup,
  buildSource: vi.fn(),
}));

describe("renderToBuffer", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("applies source, fx, and pitch options to grouped renders", async () => {
    const { renderToBuffer } = await import("./render");
    const fx: FxSpec[] = [{ name: "distortion", params: "drive=40" }];

    const rendered = await renderToBuffer({
      source: "a.wav",
      groupSources: ["b.wav"],
      durationSec: 1,
      sampleRate: 48000,
      numberOfChannels: 2,
      volume: 0.5,
      loop: 2,
      fx,
      pan: "hrtf",
      position: [1, 2, 3],
      pitch: 2,
    });

    expect(rendered).toBe(mocks.renderedBuffer);
    expect(mocks.buildGroup).toHaveBeenCalledWith(mocks.cacophony, mocks.context, ["a.wav", "b.wav"], {
      loop: 2,
      panType: "HRTF",
      position: [1, 2, 3],
      volume: 0.5,
    });
    expect(mocks.buildFxBus).toHaveBeenCalledWith(mocks.cacophony, fx);
    expect(mocks.group.routeTo).toHaveBeenCalledWith(mocks.fxBus);
    expect(mocks.group.play).toHaveBeenCalledTimes(1);
    expect(mocks.applyPitchAfterPlay).toHaveBeenCalledWith(mocks.groupSounds[0], 2);
    expect(mocks.applyPitchAfterPlay).toHaveBeenCalledWith(mocks.groupSounds[1], 2);
    expect(mocks.startRendering).toHaveBeenCalledTimes(1);
  });
});
