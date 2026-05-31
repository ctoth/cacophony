import { beforeEach, describe, expect, it, vi } from "vitest";

import { isCacophonyEffect, WaveshaperEffect } from "./effects";
import { audioContextMock, cacophony } from "./setupTests";

/**
 * The standardized-audio-context mock used in setupTests doesn't expose
 * `audioWorklet`. Worklet-backed code paths need a per-test stub so
 * `addModule` is callable. Mirrors dynamics-effect.test.ts.
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

describe("Cacophony waveshaper factories (createWaveshaper / createDistortion)", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("createWaveshaper returns a CacophonyEffect (WaveshaperEffect)", () => {
    const effect = cacophony.createWaveshaper();
    expect(isCacophonyEffect(effect)).toBe(true);
    expect(effect).toBeInstanceOf(WaveshaperEffect);
  });

  it("createDistortion also returns a WaveshaperEffect instance", () => {
    expect(cacophony.createDistortion()).toBeInstanceOf(WaveshaperEffect);
  });

  it("WaveshaperEffect.build awaits loadWaveshaper and constructs the 'waveshaper' worklet node", async () => {
    const loadSpy = vi.spyOn(cacophony, "loadWaveshaper");
    const workletSpy = vi.spyOn(cacophony, "createWorkletNode");
    const effect = cacophony.createWaveshaper({ drive: 3, shape: 1 });
    const node = await effect.build(cacophony.context);
    expect(loadSpy).toHaveBeenCalled();
    expect(node).toBeDefined();
    // Pin routing through createWorkletNode("waveshaper", ...).
    expect(workletSpy).toHaveBeenCalled();
    expect(workletSpy.mock.calls[0]?.[0]).toBe("waveshaper");
    loadSpy.mockRestore();
    workletSpy.mockRestore();
  });

  it("createWaveshaper passes options as parameterData and forwards the build context", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "createWaveshaperNode").mockResolvedValue({} as never);
    const effect = cacophony.createWaveshaper({ drive: 2, shape: 0, mix: 0.8, output: 0.5 });
    await effect.build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(
      { parameterData: { drive: 2, shape: 0, mix: 0.8, output: 0.5 } },
      cacophony.context,
    );
    createNodeSpy.mockRestore();
  });

  it("createDistortion presets tanh (shape 1) + drive 4 but lets the caller override", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "createWaveshaperNode").mockResolvedValue({} as never);
    await cacophony.createDistortion().build(cacophony.context);
    expect(createNodeSpy.mock.calls[0]?.[0]).toEqual({ parameterData: { drive: 4, shape: 1 } });
    createNodeSpy.mockClear();
    await cacophony.createDistortion({ drive: 8, mix: 0.5 }).build(cacophony.context);
    expect(createNodeSpy.mock.calls[0]?.[0]).toEqual({ parameterData: { drive: 8, shape: 1, mix: 0.5 } });
    createNodeSpy.mockRestore();
  });

  it("loadWaveshaper is idempotent — second call does not re-add the module", async () => {
    const addModule = mockAudioWorklet();
    // Force the first AudioWorkletNode construction to fail so addModule is
    // reached via the createWorkletNode fallback path.
    vi.mocked(AudioWorkletNode).mockImplementationOnce(() => {
      throw new Error("Worklet not loaded");
    });
    await cacophony.loadWaveshaper();
    const callsAfterFirst = addModule.mock.calls.length;
    await cacophony.loadWaveshaper();
    expect(addModule.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("waveshaper effect Bus integration", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("a waveshaper effect can be added to a bus's filter chain", async () => {
    const bus = cacophony.createBus("ws-bus");
    await bus.addFilter(cacophony.createDistortion({ drive: 6 }));
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });

  it("addFilter wires the built waveshaper node into the bus chain (input -> node -> output)", async () => {
    const bus = cacophony.createBus("ws-routing-bus");

    // _refreshFilters rebuilds input -> [filters...] -> output. With one
    // filter we expect bus.input to connect INTO the waveshaper node, and the
    // node to connect out to bus.output. Spy bus.input.connect before the add
    // so we capture the rebuild edge.
    const inputConnectSpy = vi.spyOn(bus.input, "connect");

    const effect = cacophony.createWaveshaper({ drive: 3, shape: 1 });
    await bus.addFilter(effect);

    expect(bus.filters.length).toBe(1);
    const wsNode = bus.filters[0];

    // bus.input connected INTO the waveshaper node during the rebuild.
    expect(inputConnectSpy).toHaveBeenCalledWith(wsNode);

    // Spy the node's own connect and force one more chain rebuild by adding a
    // second filter; the waveshaper node (now first in the chain) must connect
    // downstream to the next node — proving it is a real chain link.
    const nodeConnectSpy = vi.spyOn(wsNode, "connect");
    const second = cacophony.createBiquadFilter({ frequency: 1000 });
    await bus.addFilter(second);
    expect(nodeConnectSpy).toHaveBeenCalledWith(second);

    bus.destroy();
  });

  it("a waveshaper effect can be routed via a named bus and resolved by name", async () => {
    const bus = cacophony.createBus("route-ws-bus");
    await bus.addFilter(cacophony.createDistortion());
    expect(cacophony.getBus("route-ws-bus")).toBe(bus);
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });
});
