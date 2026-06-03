import { beforeEach, describe, expect, it, vi } from "vitest";

import { isCacophonyEffect, TremoloEffect } from "./effects";
import { audioContextMock, cacophony } from "./setupTests";
import { WORKLETS } from "./worklets";

/**
 * The standardized-audio-context mock used in setupTests doesn't expose
 * `audioWorklet`. Worklet-backed code paths need a per-test stub so
 * `addModule` is callable. Mirrors phaser-effect.test.ts.
 */
const mockAudioWorklet = () => {
  const addModule = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(audioContextMock, "audioWorklet", {
    value: { addModule },
    writable: true,
    configurable: true,
  });
  return addModule;
};

describe("Cacophony tremolo factories (createTremolo / createAutoPan)", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("createTremolo returns a CacophonyEffect (TremoloEffect)", () => {
    const effect = cacophony.createTremolo();
    expect(isCacophonyEffect(effect)).toBe(true);
    expect(effect).toBeInstanceOf(TremoloEffect);
  });

  it("createAutoPan also returns a TremoloEffect", () => {
    expect(cacophony.createAutoPan()).toBeInstanceOf(TremoloEffect);
  });

  it("build constructs the 'tremolo' worklet node", async () => {
    const workletSpy = vi.spyOn(cacophony, "createWorkletNode");
    const effect = cacophony.createTremolo({ rate: 6 });
    const node = await effect.build(cacophony.context);
    expect(node).toBeDefined();
    // Pin routing through createWorkletNode("tremolo", ...).
    expect(workletSpy).toHaveBeenCalled();
    expect(workletSpy.mock.calls[0]?.[0]).toBe("tremolo");
    workletSpy.mockRestore();
  });

  it("createTremolo passes options as parameterData and forwards the build context", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    const effect = cacophony.createTremolo({ rate: 8, depth: 0.7, shape: 2, stereoPhase: 90 });
    await effect.build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(
      WORKLETS.tremolo,
      { rate: 8, depth: 0.7, shape: 2, stereoPhase: 90 },
      cacophony.context,
    );
    createNodeSpy.mockRestore();
  });

  it("createAutoPan forces stereoPhase to 180 but lets the caller override other params", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createAutoPan({ rate: 3 }).build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(WORKLETS.tremolo, { stereoPhase: 180, rate: 3 }, cacophony.context);
    createNodeSpy.mockClear();
    // A caller-supplied stereoPhase overrides the preset (spread order).
    await cacophony.createAutoPan({ stereoPhase: 90 }).build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(WORKLETS.tremolo, { stereoPhase: 90 }, cacophony.context);
    createNodeSpy.mockRestore();
  });

  it("tremolo load is idempotent — second build does not re-add the module", async () => {
    const addModule = mockAudioWorklet();
    // Force the first AudioWorkletNode construction to fail so addModule is
    // reached via the createWorkletNode fallback path.
    vi.mocked(AudioWorkletNode).mockImplementationOnce(() => {
      throw new Error("Worklet not loaded");
    });
    await cacophony.buildWorkletEffect(WORKLETS.tremolo, {});
    const callsAfterFirst = addModule.mock.calls.length;
    await cacophony.buildWorkletEffect(WORKLETS.tremolo, {});
    expect(addModule.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("Cacophony tremolo string-mode shape aliases", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("translates shape: 'triangle' to index 1 in parameterData", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createTremolo({ rate: 8, shape: "triangle" }).build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(WORKLETS.tremolo, { rate: 8, shape: 1 }, cacophony.context);
    createNodeSpy.mockRestore();
  });

  it("translates shape: 'square' to index 2 in parameterData", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createTremolo({ shape: "square" }).build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(WORKLETS.tremolo, { shape: 2 }, cacophony.context);
    createNodeSpy.mockRestore();
  });

  it("translates shape: 'sine' to index 0 in parameterData", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createTremolo({ shape: "sine" }).build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(WORKLETS.tremolo, { shape: 0 }, cacophony.context);
    createNodeSpy.mockRestore();
  });

  it("leaves a numeric shape unchanged (backward compatible)", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createTremolo({ shape: 2 }).build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(WORKLETS.tremolo, { shape: 2 }, cacophony.context);
    createNodeSpy.mockRestore();
  });

  it("falls back to index 0 for an unknown shape string", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createTremolo({ shape: "bogus" as never }).build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(WORKLETS.tremolo, { shape: 0 }, cacophony.context);
    createNodeSpy.mockRestore();
  });
});

describe("tremolo effect Bus integration", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("a tremolo effect can be added to a bus's filter chain", async () => {
    const bus = cacophony.createBus("tremolo-bus");
    await bus.addFilter(cacophony.createTremolo());
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });

  it("addFilter wires the built tremolo node into the bus chain (input -> node -> output)", async () => {
    const bus = cacophony.createBus("tremolo-routing-bus");

    // _refreshFilters rebuilds input -> [filters...] -> output. With one filter
    // we expect bus.input to connect INTO the node, and the node to connect out
    // to bus.output. Spy bus.input.connect before the add to capture the edge.
    const inputConnectSpy = vi.spyOn(bus.input, "connect");

    const effect = cacophony.createAutoPan();
    await bus.addFilter(effect);

    expect(bus.filters.length).toBe(1);
    const tremoloNode = bus.filters[0];

    // bus.input connected INTO the tremolo node during the rebuild.
    expect(inputConnectSpy).toHaveBeenCalledWith(tremoloNode);

    // Adding a second filter forces a chain rebuild; the tremolo node (now first)
    // must connect downstream to the next node — proving it is a real chain link.
    const nodeConnectSpy = vi.spyOn(tremoloNode, "connect");
    const second = cacophony.createBiquadFilter({ frequency: 1000 });
    await bus.addFilter(second);
    expect(nodeConnectSpy).toHaveBeenCalledWith(second);

    bus.destroy();
  });
});
