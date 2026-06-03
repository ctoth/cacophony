import { beforeEach, describe, expect, it, vi } from "vitest";

import { FdnReverbEffect, isCacophonyEffect } from "./effects";
import { audioContextMock, cacophony } from "./setupTests";
import { WORKLETS } from "./worklets";

/**
 * The standardized-audio-context mock used in setupTests doesn't expose
 * `audioWorklet`. Worklet-backed code paths need a per-test stub so
 * `addModule` is callable. Mirrors dynamics-effect.test.ts / effects.test.ts.
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

describe("Cacophony FDN reverb factory (createFdnReverb)", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("createFdnReverb returns a CacophonyEffect (FdnReverbEffect)", () => {
    const effect = cacophony.createFdnReverb();
    expect(isCacophonyEffect(effect)).toBe(true);
    expect(effect).toBeInstanceOf(FdnReverbEffect);
  });

  it("FdnReverbEffect.build constructs the 'fdn-reverb' worklet node", async () => {
    const workletSpy = vi.spyOn(cacophony, "createWorkletNode");
    const effect = cacophony.createFdnReverb({ decayTime: 2, mix: 0.4 });
    const node = await effect.build(cacophony.context);
    expect(node).toBeDefined();
    // Pin routing through createWorkletNode("fdn-reverb", ...).
    expect(workletSpy).toHaveBeenCalled();
    expect(workletSpy.mock.calls[0]?.[0]).toBe("fdn-reverb");
    workletSpy.mockRestore();
  });

  it("createFdnReverb passes options as parameterData and forwards the build context", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    const effect = cacophony.createFdnReverb({ decayTime: 3, preDelay: 0.02, damping: 0.5, diffusion: 0.7, mix: 0.5 });
    await effect.build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith(
      WORKLETS.fdnReverb,
      { decayTime: 3, preDelay: 0.02, damping: 0.5, diffusion: 0.7, mix: 0.5 },
      cacophony.context,
    );
    createNodeSpy.mockRestore();
  });

  it("fdn-reverb load is idempotent — second build does not re-add the module", async () => {
    const addModule = mockAudioWorklet();
    // Force the first AudioWorkletNode construction to fail so addModule is
    // reached via the createWorkletNode fallback path.
    vi.mocked(AudioWorkletNode).mockImplementationOnce(() => {
      throw new Error("Worklet not loaded");
    });
    await cacophony.buildWorkletEffect(WORKLETS.fdnReverb, {});
    const callsAfterFirst = addModule.mock.calls.length;
    await cacophony.buildWorkletEffect(WORKLETS.fdnReverb, {});
    expect(addModule.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("FDN reverb effect Bus integration", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("an FDN reverb effect can be added to a bus's filter chain", async () => {
    const bus = cacophony.createBus("fdn-bus");
    await bus.addFilter(cacophony.createFdnReverb({ decayTime: 2 }));
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });

  it("addFilter wires the built FDN reverb node into the bus chain (input -> node -> output)", async () => {
    const bus = cacophony.createBus("fdn-routing-bus");

    // _refreshFilters rebuilds input -> [filters...] -> output. With one filter
    // we expect bus.input to connect INTO the reverb node. Spy bus.input.connect
    // before the add so we capture the rebuild edge.
    const inputConnectSpy = vi.spyOn(bus.input, "connect");

    const effect = cacophony.createFdnReverb({ decayTime: 1.2, mix: 0.4 });
    await bus.addFilter(effect);

    expect(bus.filters.length).toBe(1);
    const reverbNode = bus.filters[0];

    // bus.input connected INTO the reverb node during the rebuild.
    expect(inputConnectSpy).toHaveBeenCalledWith(reverbNode);

    // Force one more chain rebuild by adding a second filter; the reverb node
    // (now first in the chain) must connect downstream to the next node —
    // proving it is wired as a real chain link, not a dangling node.
    const nodeConnectSpy = vi.spyOn(reverbNode, "connect");
    const second = cacophony.createBiquadFilter({ frequency: 1000 });
    await bus.addFilter(second);
    expect(nodeConnectSpy).toHaveBeenCalledWith(second);

    bus.destroy();
  });

  it("an FDN reverb effect is resolvable via a named bus (routeTo target form)", async () => {
    const bus = cacophony.createBus("route-fdn-bus");
    await bus.addFilter(cacophony.createFdnReverb());
    expect(cacophony.getBus("route-fdn-bus")).toBe(bus);
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });
});
