import { beforeEach, describe, expect, it, vi } from "vitest";

import { isCacophonyEffect, ModulatedDelayEffect } from "./effects";
import { DATTORRO_INV_SQRT2 } from "./processors/modulated-delay-core";
import { audioContextMock, cacophony } from "./setupTests";
import { WORKLETS } from "./worklets";

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

describe("Cacophony modulated-delay factories (createDelay / createChorus / createFlanger / createVibrato / createDoubling)", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("createDelay returns a CacophonyEffect (ModulatedDelayEffect)", () => {
    const effect = cacophony.createDelay();
    expect(isCacophonyEffect(effect)).toBe(true);
    expect(effect).toBeInstanceOf(ModulatedDelayEffect);
  });

  it("all five factories return ModulatedDelayEffect instances", () => {
    expect(cacophony.createChorus()).toBeInstanceOf(ModulatedDelayEffect);
    expect(cacophony.createFlanger()).toBeInstanceOf(ModulatedDelayEffect);
    expect(cacophony.createVibrato()).toBeInstanceOf(ModulatedDelayEffect);
    expect(cacophony.createDoubling()).toBeInstanceOf(ModulatedDelayEffect);
  });

  it("build constructs the 'modulated-delay' worklet node", async () => {
    const workletSpy = vi.spyOn(cacophony, "createWorkletNode");
    const effect = cacophony.createDelay({ delayTime: 120 });
    const node = await effect.build(cacophony.context);
    expect(node).toBeDefined();
    // Pin routing through createWorkletNode("modulated-delay", ...).
    expect(workletSpy).toHaveBeenCalled();
    expect(workletSpy.mock.calls[0]?.[0]).toBe("modulated-delay");
    workletSpy.mockRestore();
  });

  it("createDelay passes options as parameterData and forwards the build context", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    const effect = cacophony.createDelay({ delayTime: 300, feedback: 0.4 });
    await effect.build(cacophony.context);
    // createDelay spreads the echo preset; caller overrides win.
    expect(createNodeSpy).toHaveBeenCalledWith(
      WORKLETS.modulatedDelay,
      {
        blend: 1,
        feedforward: 1,
        feedback: 0.4,
        delayTime: 300,
        depth: 0,
        rate: 0,
      },
      cacophony.context,
    );
    createNodeSpy.mockRestore();
  });

  it("createChorus lands the VERBATIM Dattorro Table 6 white-chorus knobs in parameterData", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createChorus().build(cacophony.context);
    const parameterData = createNodeSpy.mock.calls[0]?.[1] as Record<string, number>;
    // Table 6 white chorus: blend = feedback = 1/sqrt2, feedforward = 1.
    expect(parameterData.blend).toBe(DATTORRO_INV_SQRT2);
    expect(parameterData.feedforward).toBe(1);
    expect(parameterData.feedback).toBe(DATTORRO_INV_SQRT2);
    createNodeSpy.mockRestore();
  });

  it("createFlanger lands the VERBATIM Dattorro Table 6 flanger knobs (negative feedback)", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createFlanger().build(cacophony.context);
    const parameterData = createNodeSpy.mock.calls[0]?.[1] as Record<string, number>;
    expect(parameterData.blend).toBe(DATTORRO_INV_SQRT2);
    expect(parameterData.feedforward).toBe(DATTORRO_INV_SQRT2);
    expect(parameterData.feedback).toBe(-DATTORRO_INV_SQRT2);
    createNodeSpy.mockRestore();
  });

  it("createVibrato lands the VERBATIM Dattorro Table 6 vibrato knobs (100% wet)", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createVibrato().build(cacophony.context);
    const parameterData = createNodeSpy.mock.calls[0]?.[1] as Record<string, number>;
    expect(parameterData.blend).toBe(0);
    expect(parameterData.feedforward).toBe(1);
    expect(parameterData.feedback).toBe(0);
    createNodeSpy.mockRestore();
  });

  it("createDoubling lands the VERBATIM Dattorro Table 6 doubling knobs (no feedback)", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createDoubling().build(cacophony.context);
    const parameterData = createNodeSpy.mock.calls[0]?.[1] as Record<string, number>;
    expect(parameterData.blend).toBe(DATTORRO_INV_SQRT2);
    expect(parameterData.feedforward).toBe(DATTORRO_INV_SQRT2);
    expect(parameterData.feedback).toBe(0);
    createNodeSpy.mockRestore();
  });

  it("caller overrides win over a preset's knobs", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createVibrato({ rate: 7, depth: 2 }).build(cacophony.context);
    const parameterData = createNodeSpy.mock.calls[0]?.[1] as Record<string, number>;
    expect(parameterData.rate).toBe(7);
    expect(parameterData.depth).toBe(2);
    // Preset knobs untouched by the override.
    expect(parameterData.blend).toBe(0);
    createNodeSpy.mockRestore();
  });

  it("modulated-delay load is idempotent — second build does not re-add the module", async () => {
    const addModule = mockAudioWorklet();
    // Force the first AudioWorkletNode construction to fail so addModule is
    // reached via the createWorkletNode fallback path.
    vi.mocked(AudioWorkletNode).mockImplementationOnce(() => {
      throw new Error("Worklet not loaded");
    });
    await cacophony.buildWorkletEffect(WORKLETS.modulatedDelay, {});
    const callsAfterFirst = addModule.mock.calls.length;
    await cacophony.buildWorkletEffect(WORKLETS.modulatedDelay, {});
    expect(addModule.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("Cacophony modulated-delay string-mode interpolation aliases", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  const interpolationOf = (spy: ReturnType<typeof vi.spyOn>): unknown =>
    (spy.mock.calls[0]?.[1] as Record<string, unknown>).interpolation;

  it("translates interpolation: 'linear' to index 1 in parameterData", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createDelay({ interpolation: "linear" }).build(cacophony.context);
    expect(interpolationOf(createNodeSpy)).toBe(1);
    createNodeSpy.mockRestore();
  });

  it("translates interpolation: 'cubic' to index 0 in parameterData", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createDelay({ interpolation: "cubic" }).build(cacophony.context);
    expect(interpolationOf(createNodeSpy)).toBe(0);
    createNodeSpy.mockRestore();
  });

  it("leaves a numeric interpolation unchanged (backward compatible)", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createDelay({ interpolation: 1 }).build(cacophony.context);
    expect(interpolationOf(createNodeSpy)).toBe(1);
    createNodeSpy.mockRestore();
  });

  it("falls back to index 0 for an unknown interpolation string", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createDelay({ interpolation: "bogus" as never }).build(cacophony.context);
    expect(interpolationOf(createNodeSpy)).toBe(0);
    createNodeSpy.mockRestore();
  });
});

describe("modulated-delay effect Bus integration", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("a chorus effect can be added to a bus's filter chain", async () => {
    const bus = cacophony.createBus("chorus-bus");
    await bus.addFilter(cacophony.createChorus());
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });

  it("addFilter wires the built modulated-delay node into the bus chain (input -> node -> output)", async () => {
    const bus = cacophony.createBus("chorus-routing-bus");

    // _refreshFilters rebuilds input -> [filters...] -> output. With one filter
    // we expect bus.input to connect INTO the node, and the node to connect out
    // to bus.output. Spy bus.input.connect before the add to capture the edge.
    const inputConnectSpy = vi.spyOn(bus.input, "connect");

    const effect = cacophony.createFlanger();
    await bus.addFilter(effect);

    expect(bus.filters.length).toBe(1);
    const delayNode = bus.filters[0];

    // bus.input connected INTO the modulated-delay node during the rebuild.
    expect(inputConnectSpy).toHaveBeenCalledWith(delayNode);

    // Adding a second filter forces a chain rebuild; the delay node (now first)
    // must connect downstream to the next node — proving it is a real chain link.
    const nodeConnectSpy = vi.spyOn(delayNode, "connect");
    const second = cacophony.createBiquadFilter({ frequency: 1000 });
    await bus.addFilter(second);
    expect(nodeConnectSpy).toHaveBeenCalledWith(second);

    bus.destroy();
  });
});
