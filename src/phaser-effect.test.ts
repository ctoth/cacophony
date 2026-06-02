import { beforeEach, describe, expect, it, vi } from "vitest";

import { isCacophonyEffect, PhaserEffect } from "./effects";
import { audioContextMock, cacophony } from "./setupTests";

/**
 * The standardized-audio-context mock used in setupTests doesn't expose
 * `audioWorklet`. Worklet-backed code paths need a per-test stub so
 * `addModule` is callable. Mirrors modulated-delay-effect.test.ts.
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

describe("Cacophony phaser factory (createPhaser)", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("createPhaser returns a CacophonyEffect (PhaserEffect)", () => {
    const effect = cacophony.createPhaser();
    expect(isCacophonyEffect(effect)).toBe(true);
    expect(effect).toBeInstanceOf(PhaserEffect);
  });

  it("build awaits loadPhaser and constructs the 'phaser' worklet node", async () => {
    const loadSpy = vi.spyOn(cacophony, "loadPhaser");
    const workletSpy = vi.spyOn(cacophony, "createWorkletNode");
    const effect = cacophony.createPhaser({ frequency: 800 });
    const node = await effect.build(cacophony.context);
    expect(loadSpy).toHaveBeenCalled();
    expect(node).toBeDefined();
    // Pin routing through createWorkletNode("phaser", ...).
    expect(workletSpy).toHaveBeenCalled();
    expect(workletSpy.mock.calls[0]?.[0]).toBe("phaser");
    loadSpy.mockRestore();
    workletSpy.mockRestore();
  });

  it("createPhaser passes options as parameterData and forwards the build context", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "createPhaserNode").mockResolvedValue({} as never);
    const effect = cacophony.createPhaser({ frequency: 1200, rate: 1, depth: 2, stages: 6, feedback: 0.4, mix: 0.8 });
    await effect.build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(
      { parameterData: { frequency: 1200, rate: 1, depth: 2, stages: 6, feedback: 0.4, mix: 0.8 } },
      cacophony.context,
    );
    createNodeSpy.mockRestore();
  });

  it("loadPhaser is idempotent — second call does not re-add the module", async () => {
    const addModule = mockAudioWorklet();
    // Force the first AudioWorkletNode construction to fail so addModule is
    // reached via the createWorkletNode fallback path.
    vi.mocked(AudioWorkletNode).mockImplementationOnce(() => {
      throw new Error("Worklet not loaded");
    });
    await cacophony.loadPhaser();
    const callsAfterFirst = addModule.mock.calls.length;
    await cacophony.loadPhaser();
    expect(addModule.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("phaser effect Bus integration", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("a phaser effect can be added to a bus's filter chain", async () => {
    const bus = cacophony.createBus("phaser-bus");
    await bus.addFilter(cacophony.createPhaser());
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });

  it("addFilter wires the built phaser node into the bus chain (input -> node -> output)", async () => {
    const bus = cacophony.createBus("phaser-routing-bus");

    // _refreshFilters rebuilds input -> [filters...] -> output. With one filter
    // we expect bus.input to connect INTO the node, and the node to connect out
    // to bus.output. Spy bus.input.connect before the add to capture the edge.
    const inputConnectSpy = vi.spyOn(bus.input, "connect");

    const effect = cacophony.createPhaser();
    await bus.addFilter(effect);

    expect(bus.filters.length).toBe(1);
    const phaserNode = bus.filters[0];

    // bus.input connected INTO the phaser node during the rebuild.
    expect(inputConnectSpy).toHaveBeenCalledWith(phaserNode);

    // Adding a second filter forces a chain rebuild; the phaser node (now first)
    // must connect downstream to the next node — proving it is a real chain link.
    const nodeConnectSpy = vi.spyOn(phaserNode, "connect");
    const second = cacophony.createBiquadFilter({ frequency: 1000 });
    await bus.addFilter(second);
    expect(nodeConnectSpy).toHaveBeenCalledWith(second);

    bus.destroy();
  });
});
