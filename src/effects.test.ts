import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BiquadEffect,
  isCacophonyBuiltBiquad,
  isCacophonyEffect,
  markAsCacophonyBiquad,
  ShareEffect,
} from "./effects";
import { audioContextMock, cacophony } from "./setupTests";

/**
 * The standardized-audio-context mock used in setupTests doesn't expose
 * `audioWorklet`. Every test that exercises a worklet-backed code path
 * needs a per-test stub so `addModule` is callable. Returns the spy so
 * tests can assert on it if needed.
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

describe("effects: markAsCacophonyBiquad / isCacophonyBuiltBiquad", () => {
  it("returns false for a raw biquad created directly on the context", () => {
    const raw = cacophony.context.createBiquadFilter();
    expect(isCacophonyBuiltBiquad(raw)).toBe(false);
  });

  it("returns true for a biquad produced by cacophony.createBiquadFilter", () => {
    const built = cacophony.createBiquadFilter({ type: "lowpass", frequency: 1000 });
    expect(isCacophonyBuiltBiquad(built)).toBe(true);
  });

  it("returns true after explicitly marking a node", () => {
    const raw = cacophony.context.createBiquadFilter();
    expect(isCacophonyBuiltBiquad(raw)).toBe(false);
    markAsCacophonyBiquad(raw);
    expect(isCacophonyBuiltBiquad(raw)).toBe(true);
  });

  it("returns false for non-node values", () => {
    expect(isCacophonyBuiltBiquad(null)).toBe(false);
    expect(isCacophonyBuiltBiquad(undefined)).toBe(false);
    expect(isCacophonyBuiltBiquad({})).toBe(false);
    expect(isCacophonyBuiltBiquad("filter")).toBe(false);
  });
});

describe("effects: isCacophonyEffect", () => {
  it("returns true for any object with a build function", () => {
    const effect = { build: () => cacophony.context.createGain() };
    expect(isCacophonyEffect(effect)).toBe(true);
  });

  it("returns false for objects without a build function", () => {
    expect(isCacophonyEffect({})).toBe(false);
    expect(isCacophonyEffect({ build: 42 })).toBe(false);
    expect(isCacophonyEffect(null)).toBe(false);
    expect(isCacophonyEffect(undefined)).toBe(false);
  });

  it("returns true for built-in BiquadEffect and ShareEffect", () => {
    const biquad = cacophony.createBiquadFilter({ frequency: 500 });
    expect(isCacophonyEffect(new BiquadEffect(biquad))).toBe(true);
    expect(isCacophonyEffect(new ShareEffect(cacophony.context.createGain()))).toBe(true);
  });
});

describe("effects: BiquadEffect", () => {
  it("build returns the wrapped biquad instance", () => {
    const biquad = cacophony.createBiquadFilter({ frequency: 800 });
    const effect = new BiquadEffect(biquad);
    expect(effect.build(cacophony.context)).toBe(biquad);
  });
});

describe("effects: ShareEffect", () => {
  it("build returns the wrapped node instance every time", () => {
    const node = cacophony.context.createGain();
    const effect = new ShareEffect(node);
    expect(effect.build(cacophony.context)).toBe(node);
    expect(effect.build(cacophony.context)).toBe(node);
  });
});

describe("Cacophony.shareEffect", () => {
  it("returns a CacophonyEffect that build()s to the supplied node", () => {
    const node = cacophony.context.createGain();
    const effect = cacophony.shareEffect(node);
    expect(isCacophonyEffect(effect)).toBe(true);
    expect(effect.build(cacophony.context)).toBe(node);
  });
});

describe("Cacophony.createReverb / loadDattorroReverb", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("createReverb returns a CacophonyEffect (ReverbEffect)", () => {
    const effect = cacophony.createReverb();
    expect(isCacophonyEffect(effect)).toBe(true);
  });

  it("ReverbEffect.build awaits loadDattorroReverb and returns an AudioWorkletNode", async () => {
    const loadSpy = vi.spyOn(cacophony, "loadDattorroReverb");
    const effect = cacophony.createReverb({ wet: 0.5, dry: 0.5 });
    const node = await effect.build(cacophony.context);
    expect(loadSpy).toHaveBeenCalled();
    expect(node).toBeDefined();
    loadSpy.mockRestore();
  });

  it("loadDattorroReverb is idempotent — second call does not re-add the module", async () => {
    const addModule = mockAudioWorklet();
    // Force AudioWorkletNode construction to fail first time so addModule
    // is reached; cacophony's createWorkletNode falls back to loadAudioWorkletModule.
    vi.mocked(AudioWorkletNode).mockImplementationOnce(() => {
      throw new Error("Worklet not loaded");
    });
    await cacophony.loadDattorroReverb();
    const addModuleCallsAfterFirst = addModule.mock.calls.length;
    await cacophony.loadDattorroReverb();
    // Second call should short-circuit (loadedAudioWorklets has the name).
    expect(addModule.mock.calls.length).toBe(addModuleCallsAfterFirst);
  });

  it("createReverb passes options as parameterData to the worklet", async () => {
    const createNodeSpy = vi
      .spyOn(cacophony, "createDattorroReverbNode")
      .mockResolvedValue({} as any);
    const effect = cacophony.createReverb({ wet: 0.7, dry: 0.3, decay: 0.8 });
    await effect.build(cacophony.context);
    expect(createNodeSpy).toHaveBeenCalledWith({
      parameterData: { wet: 0.7, dry: 0.3, decay: 0.8 },
    });
    createNodeSpy.mockRestore();
  });

  it("createReverb effect can be added to a bus's filter chain", async () => {
    const bus = cacophony.createBus("reverb-bus");
    const reverb = cacophony.createReverb({ wet: 0.4 });
    await bus.addFilter(reverb);
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });
});
