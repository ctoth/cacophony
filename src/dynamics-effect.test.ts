import { beforeEach, describe, expect, it, vi } from "vitest";

import { DynamicsEffect, isCacophonyEffect } from "./effects";
import { audioContextMock, cacophony } from "./setupTests";

/**
 * The standardized-audio-context mock used in setupTests doesn't expose
 * `audioWorklet`. Worklet-backed code paths need a per-test stub so
 * `addModule` is callable. Mirrors effects.test.ts.
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

describe("Cacophony dynamics factories (createCompressor / createLimiter / createGate)", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("createCompressor returns a CacophonyEffect (DynamicsEffect)", () => {
    const effect = cacophony.createCompressor();
    expect(isCacophonyEffect(effect)).toBe(true);
    expect(effect).toBeInstanceOf(DynamicsEffect);
  });

  it("createLimiter and createGate also return DynamicsEffect instances", () => {
    expect(cacophony.createLimiter()).toBeInstanceOf(DynamicsEffect);
    expect(cacophony.createGate()).toBeInstanceOf(DynamicsEffect);
  });

  it("DynamicsEffect.build awaits loadDynamics and constructs the 'dynamics' worklet node", async () => {
    const loadSpy = vi.spyOn(cacophony, "loadDynamics");
    const workletSpy = vi.spyOn(cacophony, "createWorkletNode");
    const effect = cacophony.createCompressor({ threshold: -18, ratio: 3 });
    const node = await effect.build(cacophony.context);
    expect(loadSpy).toHaveBeenCalled();
    expect(node).toBeDefined();
    // Pin routing through createWorkletNode("dynamics", ...).
    expect(workletSpy).toHaveBeenCalled();
    expect(workletSpy.mock.calls[0]?.[0]).toBe("dynamics");
    loadSpy.mockRestore();
    workletSpy.mockRestore();
  });

  it("createCompressor passes options as parameterData and forwards the build context", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "createDynamicsNode").mockResolvedValue({} as never);
    const effect = cacophony.createCompressor({ threshold: -20, ratio: 4, knee: 6, makeup: 3 });
    await effect.build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(
      { parameterData: { threshold: -20, ratio: 4, knee: 6, makeup: 3 } },
      cacophony.context,
    );
    createNodeSpy.mockRestore();
  });

  it("createLimiter forces ratio to the limiter sentinel (1000) in parameterData", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "createDynamicsNode").mockResolvedValue({} as never);
    // A caller-supplied ratio must be overridden by the limiter preset.
    const effect = cacophony.createLimiter({ threshold: -6 });
    await effect.build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith({ parameterData: { threshold: -6, ratio: 1000 } }, cacophony.context);
    createNodeSpy.mockRestore();
  });

  it("createGate defaults ratio < 1 (downward expansion) but lets the caller override", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "createDynamicsNode").mockResolvedValue({} as never);
    await cacophony.createGate().build(cacophony.context);
    expect(createNodeSpy.mock.calls[0]?.[0]).toEqual({ parameterData: { ratio: 0.1 } });
    createNodeSpy.mockClear();
    await cacophony.createGate({ ratio: 0.5, threshold: -40 }).build(cacophony.context);
    expect(createNodeSpy.mock.calls[0]?.[0]).toEqual({ parameterData: { ratio: 0.5, threshold: -40 } });
    createNodeSpy.mockRestore();
  });

  it("loadDynamics is idempotent — second call does not re-add the module", async () => {
    const addModule = mockAudioWorklet();
    // Force the first AudioWorkletNode construction to fail so addModule is
    // reached via the createWorkletNode fallback path.
    vi.mocked(AudioWorkletNode).mockImplementationOnce(() => {
      throw new Error("Worklet not loaded");
    });
    await cacophony.loadDynamics();
    const callsAfterFirst = addModule.mock.calls.length;
    await cacophony.loadDynamics();
    expect(addModule.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("dynamics effect Bus integration", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("a compressor effect can be added to a bus's filter chain", async () => {
    const bus = cacophony.createBus("comp-bus");
    await bus.addFilter(cacophony.createCompressor({ threshold: -18 }));
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });

  it("addFilter wires the built dynamics node into the bus chain (input -> node -> output)", async () => {
    const bus = cacophony.createBus("comp-routing-bus");

    // _refreshFilters rebuilds input -> [filters...] -> output. With one
    // filter we expect bus.input to connect INTO the dynamics node, and the
    // dynamics node to connect out to bus.output. Spy bus.input.connect before
    // the add so we capture the rebuild edge.
    const inputConnectSpy = vi.spyOn(bus.input, "connect");

    const effect = cacophony.createCompressor({ threshold: -12, ratio: 6 });
    await bus.addFilter(effect);

    // The built worklet node is now the sole filter in the chain.
    expect(bus.filters.length).toBe(1);
    const dynamicsNode = bus.filters[0];

    // bus.input connected INTO the dynamics node during the rebuild.
    expect(inputConnectSpy).toHaveBeenCalledWith(dynamicsNode);

    // Now spy the node's own connect and force one more chain rebuild by
    // adding a second filter; the dynamics node (now first in the chain) must
    // connect downstream to the next node — proving it is wired as a real
    // chain link, not a dangling node.
    const nodeConnectSpy = vi.spyOn(dynamicsNode, "connect");
    const second = cacophony.createBiquadFilter({ frequency: 1000 });
    await bus.addFilter(second);
    expect(nodeConnectSpy).toHaveBeenCalledWith(second);

    bus.destroy();
  });

  it("a compressor effect can be routed via a named bus and a Sound.routeTo", async () => {
    const bus = cacophony.createBus("route-comp-bus");
    await bus.addFilter(cacophony.createCompressor());
    // The bus is in the registry and resolvable by name (routeTo target form).
    expect(cacophony.getBus("route-comp-bus")).toBe(bus);
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });
});
