import { AudioBuffer } from "standardized-audio-context-mock";
import { describe, expect, it, vi } from "vitest";
import { audioContextMock, cacophony, expectNotReachable, expectPath } from "./setupTests";

async function prepare() {
  const sound = await cacophony.createSound(new AudioBuffer({ length: 44_100, sampleRate: 44_100 }), "buffer", "HRTF");
  const [voice] = sound.preplay();
  const filterFactory = vi.spyOn(audioContextMock, "createBiquadFilter");
  const gainFactory = vi.spyOn(audioContextMock, "createGain");
  return { sound, voice, filterFactory, gainFactory };
}

describe("per-playback occlusion", () => {
  it("is lazy and places dedicated filtering and attenuation after user effects, before HRTF", async () => {
    const { sound, voice, filterFactory, gainFactory } = await prepare();
    expect(voice.occlusion).toBe(0);
    voice.setOcclusion(0);
    expect(filterFactory).not.toHaveBeenCalled();
    expect(gainFactory).not.toHaveBeenCalled();
    const userFilter = audioContextMock.createBiquadFilter();
    voice.addFilter(userFilter);
    const effect = audioContextMock.createGain();
    await voice.addEffect({ build: () => effect });
    voice.volume = 0.6;
    voice.setOcclusion(1, 0);
    const filter = filterFactory.mock.results.at(-1)!.value;
    const attenuation = gainFactory.mock.results.at(-1)!.value;
    expect(filter.type).toBe("lowpass");
    expect(filter.Q.value).toBeCloseTo(-3.0103);
    expect(filter.frequency.value).toBeCloseTo(800);
    expect(attenuation.gain.value).toBeCloseTo(10 ** (-18 / 20));
    expect(voice.volume).toBe(0.6);
    expect(voice.filters).toEqual([userFilter]);
    expectPath(
      voice.source!,
      [userFilter, effect, filter, attenuation, voice.panner!, voice.outputNode],
      cacophony.master.input,
    );
    expect(voice.occlusion).toBe(1);
    sound.cleanup();
  });

  it("clamps finite amounts and rejects non-finite inputs and invalid durations before allocation", async () => {
    const { sound, voice, filterFactory } = await prepare();
    for (const amount of [NaN, Infinity, -Infinity]) expect(() => voice.setOcclusion(amount)).toThrow(RangeError);
    for (const duration of [-1, NaN, Infinity]) expect(() => voice.setOcclusion(0.5, duration)).toThrow(RangeError);
    voice.setOcclusion(-1);
    expect(voice.occlusion).toBe(0);
    expect(filterFactory).not.toHaveBeenCalled();
    voice.setOcclusion(2, 0);
    expect(voice.occlusion).toBe(1);
    voice.setOcclusion(-2, 0);
    expect(voice.occlusion).toBe(0);
    sound.cleanup();
  });

  it("reuses nodes and re-anchors interrupted linear ramps at their interpolated values", async () => {
    const { sound, voice, filterFactory, gainFactory } = await prepare();
    let now = 2;
    vi.spyOn(audioContextMock, "currentTime", "get").mockImplementation(() => now);
    voice.setOcclusion(1, 100);
    const filter = filterFactory.mock.results[0]!.value;
    const attenuation = gainFactory.mock.results[0]!.value;
    const frequencySet = vi.spyOn(filter.frequency, "setValueAtTime");
    const frequencyRamp = vi.spyOn(filter.frequency, "linearRampToValueAtTime");
    const frequencyCancel = vi.spyOn(filter.frequency, "cancelScheduledValues");
    const gainSet = vi.spyOn(attenuation.gain, "setValueAtTime");
    const gainRamp = vi.spyOn(attenuation.gain, "linearRampToValueAtTime");
    const gainCancel = vi.spyOn(attenuation.gain, "cancelScheduledValues");
    now = 2.025;
    voice.setOcclusion(0);
    const nyquist = audioContextMock.sampleRate / 2;
    expect(frequencyCancel).toHaveBeenCalledWith(now);
    expect(gainCancel).toHaveBeenCalledWith(now);
    expect(frequencySet.mock.calls[0]![0]).toBeCloseTo(nyquist + (800 - nyquist) * 0.25, 8);
    expect(frequencySet.mock.calls[0]![1]).toBe(now);
    expect(gainSet.mock.calls[0]![0]).toBeCloseTo(1 + (10 ** (-18 / 20) - 1) * 0.25, 12);
    expect(gainSet.mock.calls[0]![1]).toBe(now);
    expect(frequencyRamp).toHaveBeenCalledWith(nyquist, now + 0.05);
    expect(gainRamp).toHaveBeenCalledWith(1, now + 0.05);
    now += 0.1;
    voice.setOcclusion(0.5, 0);
    expect(frequencySet.mock.lastCall![0]).toBeCloseTo(Math.sqrt(nyquist * 800), 8);
    expect(frequencySet.mock.lastCall![1]).toBe(now);
    expect(gainSet).toHaveBeenLastCalledWith(10 ** (-9 / 20), now);
    expect(filterFactory).toHaveBeenCalledOnce();
    expect(gainFactory).toHaveBeenCalledOnce();
    sound.cleanup();
  });

  it("preserves user filter order, bypass, pause/resume, and panner replacement", async () => {
    const { sound, voice, filterFactory, gainFactory } = await prepare();
    voice.setOcclusion(0.7, 0);
    const filter = filterFactory.mock.results[0]!.value;
    const attenuation = gainFactory.mock.results[0]!.value;
    const first = audioContextMock.createBiquadFilter();
    const second = audioContextMock.createBiquadFilter();
    voice.addFilters([first, second]);
    voice.setFilterOrder([second, first]);
    voice.play();
    voice.pause();
    voice.play();
    voice.setPanType("stereo", audioContextMock);
    expectPath(
      voice.source!,
      [second, first, filter, attenuation, voice.panner!, voice.outputNode],
      cacophony.master.input,
    );
    voice.setFilterBypassed(first, true);
    expectPath(voice.source!, [second, filter, attenuation, voice.panner!, voice.outputNode], cacophony.master.input);
    voice.removeFilter(second);
    expectPath(voice.source!, [filter, attenuation, voice.panner!, voice.outputNode], cacophony.master.input);
    expect(voice.occlusion).toBe(0.7);
    sound.cleanup();
  });

  it("keeps concurrent voices and clones independent of container volume and fades", async () => {
    const { sound, voice, filterFactory, gainFactory } = await prepare();
    const [other] = sound.preplay();
    voice.setOcclusion(0.8, 0);
    const filter = filterFactory.mock.results.at(-1)!.value;
    const attenuation = gainFactory.mock.results.at(-1)!.value;
    const clone = voice.clone();
    expect(clone.occlusion).toBe(0.8);
    const clonedFilter = filterFactory.mock.results.at(-1)!.value;
    const clonedAttenuation = gainFactory.mock.results.at(-1)!.value;
    expect(clonedFilter).not.toBe(filter);
    expect(clonedAttenuation).not.toBe(attenuation);
    expectPath(
      clone.source!,
      [clonedFilter, clonedAttenuation, clone.panner!, clone.outputNode],
      cacophony.master.input,
    );
    clone.setOcclusion(0, 0);
    expect(voice.occlusion).toBe(0.8);
    expect(other.occlusion).toBe(0);
    const gainRamp = vi.spyOn(voice.gainNode!.gain, "linearRampToValueAtTime");
    const fading = voice.fadeTo(0.2, 100);
    voice.setOcclusion(0.4);
    expect(voice.isFading).toBe(true);
    expect(gainRamp).toHaveBeenCalledOnce();
    sound.volume = 0.3;
    expect(voice.occlusion).toBe(0.4);
    expect(clone.occlusion).toBe(0);
    expect(other.occlusion).toBe(0);
    await fading;
    sound.cleanup();
  });

  it("disconnects and cancels owned nodes on cleanup and rejects resurrection", async () => {
    const { sound, voice, filterFactory, gainFactory } = await prepare();
    voice.setOcclusion(1);
    const source = voice.source!;
    const filter = filterFactory.mock.results[0]!.value;
    const attenuation = gainFactory.mock.results[0]!.value;
    const panner = voice.panner!;
    const frequencyCancel = vi.spyOn(filter.frequency, "cancelScheduledValues");
    const gainCancel = vi.spyOn(attenuation.gain, "cancelScheduledValues");
    voice.cleanup();
    voice.cleanup();
    expectNotReachable(source, panner);
    expectNotReachable(filter, panner);
    expectNotReachable(attenuation, panner);
    expect(frequencyCancel).toHaveBeenCalledOnce();
    expect(gainCancel).toHaveBeenCalledOnce();
    expect(() => voice.setOcclusion(0.5)).toThrow(/cleaned up/);
    expect(filterFactory).toHaveBeenCalledOnce();
    sound.cleanup();
  });
});
