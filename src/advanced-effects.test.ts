import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BarberpoleEffect,
  FrequencyShifterEffect,
  HarmonizerEffect,
  SpectralFreezeEffect,
  StereoWidenerEffect,
} from "./effects";
import { audioContextMock, cacophony } from "./setupTests";
import { WORKLETS } from "./worklets";

beforeEach(() => {
  Object.defineProperty(audioContextMock, "audioWorklet", {
    value: { addModule: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

describe("advanced paper-effect factories", () => {
  it("exposes five distinct CacophonyEffect types", () => {
    expect(cacophony.createFrequencyShifter()).toBeInstanceOf(FrequencyShifterEffect);
    expect(cacophony.createBarberpole()).toBeInstanceOf(BarberpoleEffect);
    expect(cacophony.createHarmonizer()).toBeInstanceOf(HarmonizerEffect);
    expect(cacophony.createSpectralFreeze()).toBeInstanceOf(SpectralFreezeEffect);
    expect(cacophony.createStereoWidener()).toBeInstanceOf(StereoWidenerEffect);
  });

  it.each([
    [
      "frequency shifter",
      () => cacophony.createFrequencyShifter({ frequency: -220, mix: 0.8 }),
      WORKLETS.frequencyShifter,
      { frequency: -220, mix: 0.8 },
    ],
    [
      "barberpole",
      () => cacophony.createBarberpole({ rate: -0.2, stages: 24, coefficient: -0.4, mix: 0.9 }),
      WORKLETS.barberpole,
      { rate: -0.2, stages: 24, coefficient: -0.4, mix: 0.9 },
    ],
    [
      "harmonizer",
      () => cacophony.createHarmonizer({ semitonesA: 4, semitonesB: 7 }),
      WORKLETS.harmonizer,
      { semitonesA: 4, semitonesB: 7 },
    ],
    [
      "spectral freeze",
      () => cacophony.createSpectralFreeze({ freeze: 1, smear: 0.7 }),
      WORKLETS.spectralFreeze,
      { freeze: 1, smear: 0.7 },
    ],
  ])("builds the %s worklet with its parameterData", async (_name, factory, worklet, options) => {
    const spy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await factory().build(cacophony.context);
    expect(spy).toHaveBeenCalledWith(worklet, options, cacophony.context);
    spy.mockRestore();
  });

  it("builds the widener as an explicit two-channel output", async () => {
    const spy = vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue({} as never);
    await cacophony.createStereoWidener({ width: 0.8 }).build(cacophony.context);
    expect(spy).toHaveBeenCalledWith(
      WORKLETS.stereoWidener,
      { width: 0.8 },
      cacophony.context,
      expect.objectContaining({ outputChannelCount: [2], channelCountMode: "explicit" }),
    );
    spy.mockRestore();
  });

  it("all five effects integrate into a bus chain", async () => {
    const spy = vi
      .spyOn(cacophony, "buildWorkletEffect")
      .mockImplementation(async () => audioContextMock.createGain() as never);
    const bus = cacophony.createBus("advanced-paper-effects");
    await bus.addFilter(cacophony.createFrequencyShifter());
    await bus.addFilter(cacophony.createBarberpole());
    await bus.addFilter(cacophony.createHarmonizer());
    await bus.addFilter(cacophony.createSpectralFreeze());
    await bus.addFilter(cacophony.createStereoWidener());
    expect(bus.filters).toHaveLength(5);
    bus.destroy();
    spy.mockRestore();
  });
});
