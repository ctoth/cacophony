import { AudioContext } from "standardized-audio-context-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BiquadEffect, isCacophonyBuiltBiquad, isCacophonyEffect, markAsCacophonyBiquad, ShareEffect } from "./effects";
import { audioContextMock, cacophony } from "./setupTests";
import { WORKLETS } from "./worklets";

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

describe("Cacophony.createReverb / dattorro-reverb worklet", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("createReverb returns a CacophonyEffect (ReverbEffect)", () => {
    const effect = cacophony.createReverb();
    expect(isCacophonyEffect(effect)).toBe(true);
  });

  it("ReverbEffect.build constructs the 'dattorro-reverb' worklet node", async () => {
    const workletSpy = vi.spyOn(cacophony, "createWorkletNode");
    const effect = cacophony.createReverb({ wet: 0.5, dry: 0.5 });
    const node = await effect.build(cacophony.context);
    expect(node).toBeDefined();
    // The constructed AudioWorkletNode must be the dattorro-reverb processor
    // (not some other worklet). Asserting the name pins the routing through
    // createWorkletNode("dattorro-reverb", ...).
    expect(workletSpy).toHaveBeenCalled();
    expect(workletSpy.mock.calls[0]?.[0]).toBe("dattorro-reverb");
    workletSpy.mockRestore();
  });

  it("dattorro-reverb load is idempotent — second build does not re-add the module", async () => {
    const addModule = mockAudioWorklet();
    // Force AudioWorkletNode construction to fail first time so addModule
    // is reached; cacophony's createWorkletNode falls back to loadAudioWorkletModule.
    vi.mocked(AudioWorkletNode).mockImplementationOnce(function MockUnloadedAudioWorkletNode() {
      throw new Error("Worklet not loaded");
    });
    await cacophony.buildWorkletEffect(WORKLETS.dattorroReverb, {});
    const addModuleCallsAfterFirst = addModule.mock.calls.length;
    await cacophony.buildWorkletEffect(WORKLETS.dattorroReverb, {});
    // Second call should short-circuit (loadedAudioWorklets has the name).
    expect(addModule.mock.calls.length).toBe(addModuleCallsAfterFirst);
  });

  it("createReverb passes options as parameterData to the worklet (and forwards the build context)", async () => {
    const createNodeSpy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    const effect = cacophony.createReverb({ wet: 0.7, dry: 0.3, decay: 0.8 });
    await effect.build(cacophony.context);
    // ReverbEffect.build forwards the supplied context as the third arg so
    // cross-context use (effect on a bus whose context differs from the
    // host's own) constructs the worklet on the right context.
    expect(createNodeSpy).toHaveBeenCalledWith(
      WORKLETS.dattorroReverb,
      { wet: 0.7, dry: 0.3, decay: 0.8 },
      cacophony.context,
    );
    createNodeSpy.mockRestore();
  });

  it("createReverb effect can be added to a bus's filter chain", async () => {
    const bus = cacophony.createBus("reverb-bus");
    const reverb = cacophony.createReverb({ wet: 0.4 });
    await bus.addFilter(reverb);
    expect(bus.filters.length).toBe(1);
    bus.destroy();
  });

  it("ReverbEffect.build(contextB) calls addModule on contextB even after the worklet was loaded on contextA", async () => {
    // Regression for codex MAJOR finding: `loadedAudioWorklets` was a single
    // `Set<string>` on the host Cacophony. After loading "dattorro-reverb"
    // on contextA, calling effect.build(contextB) skipped
    // `contextB.audioWorklet.addModule()` because the name was in the host
    // set, leaving B with no registered worklet and the construct path
    // throwing. Per-context keying (WeakMap<BaseContext, Set<string>>) fixes
    // this — module loaded for context X is not "loaded" for context Y.

    // Step 1: load "dattorro-reverb" on contextA (the host context).
    // `buildWorkletEffect` pre-loads the module via `audioWorklet.addModule()`
    // before constructing the node, so addModule runs on contextA.
    const addModuleA = mockAudioWorklet();
    await cacophony.buildWorkletEffect(WORKLETS.dattorroReverb, {});
    expect(addModuleA).toHaveBeenCalledTimes(1);

    // Step 2: build a second, distinct mock context with its own addModule
    // spy. This is the cross-context case (e.g. a Bus on a different context).
    const contextB = new AudioContext();
    const addModuleB = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(contextB, "audioWorklet", {
      value: { addModule: addModuleB },
      writable: true,
      configurable: true,
    });

    // Step 3: force the first construct on B to throw so the fallback load
    // path runs. Under the pre-fix host-scoped cache, the fallback skipped
    // addModule on B by name alone, leaving B without the module.
    vi.mocked(AudioWorkletNode).mockImplementationOnce(function MockUnloadedAudioWorkletNode() {
      throw new Error("Worklet not loaded on B");
    });

    const effect = cacophony.createReverb({ wet: 0.5 });
    await effect.build(contextB as any);

    // The fix: addModule must run on contextB. Pre-fix this assertion fails
    // because the host-set short-circuit skipped the load.
    expect(addModuleB).toHaveBeenCalledTimes(1);
    // And addModule must NOT have been re-called on contextA — the per-context
    // cache still short-circuits same-context reloads.
    expect(addModuleA).toHaveBeenCalledTimes(1);
  });
});
