import { beforeEach, describe, expect, it, vi } from "vitest";
import { audioContextMock, cacophony } from "./setupTests";
import type { Synth } from "./synth";
import { SynthGroup } from "./synthGroup";

describe("SynthGroup class", () => {
  let group: SynthGroup;
  let synth1: Synth;
  let synth2: Synth;

  beforeEach(() => {
    synth1 = cacophony.createOscillator({ frequency: 440, type: "sine" });
    synth2 = cacophony.createOscillator({ frequency: 660, type: "square" });
    group = new SynthGroup([synth1, synth2]);
  });

  it("can add and remove synths from a group", () => {
    expect(group.synths.length).toBe(2);

    const synth3 = cacophony.createOscillator({ frequency: 880, type: "triangle" });
    group.addSynth(synth3);

    expect(group.synths.length).toBe(3);
    expect(group.synths).toContain(synth3);

    group.removeSynth(synth3);

    expect(group.synths.length).toBe(2);
    expect(group.synths).not.toContain(synth3);
  });

  it("plays, pauses, resumes, and stops grouped synths", () => {
    const playbacks = group.play();

    expect(playbacks).toHaveLength(2);
    expect(group.isPlaying).toBe(true);

    group.pause();
    expect(group.isPlaying).toBe(false);

    group.resume();
    expect(group.isPlaying).toBe(true);

    group.stop();
    expect(group.isPlaying).toBe(false);
  });

  it("exposes volume as a real property", () => {
    group.volume = 0.5;

    expect(synth1.volume).toBe(0.5);
    expect(synth2.volume).toBe(0.5);
    expect(group.volume).toBe(0.5);
  });

  it("returns volume 1 for an empty group", () => {
    expect(new SynthGroup().volume).toBe(1);
  });

  it("delegates stereo pan to grouped stereo synths", () => {
    const stereoSynth1 = cacophony.createOscillator({ frequency: 220, type: "sine" }, "stereo");
    const stereoSynth2 = cacophony.createOscillator({ frequency: 330, type: "triangle" }, "stereo");
    const stereoGroup = new SynthGroup([stereoSynth1, stereoSynth2]);

    stereoGroup.stereoPan = -0.25;

    expect(stereoSynth1.stereoPan).toBe(-0.25);
    expect(stereoSynth2.stereoPan).toBe(-0.25);
    expect(stereoGroup.stereoPan).toBe(-0.25);
  });

  it("delegates position to grouped synths", () => {
    group.position = [1, 2, 3];

    expect(synth1.position).toEqual([1, 2, 3]);
    expect(synth2.position).toEqual([1, 2, 3]);
    expect(group.position).toEqual([1, 2, 3]);
  });

  it("delegates synth-wide helpers", () => {
    group.frequency = 880;
    group.detune = 12;
    group.type = "triangle";

    expect(synth1.frequency).toBe(880);
    expect(synth2.frequency).toBe(880);
    expect(group.frequency).toBe(880);

    expect(synth1.detune).toBe(12);
    expect(synth2.detune).toBe(12);
    expect(group.detune).toBe(12);

    expect(synth1.type).toBe("triangle");
    expect(synth2.type).toBe("triangle");
    expect(group.type).toBe("triangle");
  });

  it("delegates filter operations to all synths", () => {
    const filter = audioContextMock.createBiquadFilter();

    group.addFilter(filter);

    expect(synth1.filters).toContain(filter);
    expect(synth2.filters).toContain(filter);

    group.removeFilter(filter);

    expect(synth1.filters).toHaveLength(0);
    expect(synth2.filters).toHaveLength(0);
  });

  it("delegates fade helpers to all synths", async () => {
    const fadeTo1 = vi.spyOn(synth1, "fadeTo").mockResolvedValue(undefined);
    const fadeTo2 = vi.spyOn(synth2, "fadeTo").mockResolvedValue(undefined);
    const fadeIn1 = vi.spyOn(synth1, "fadeIn").mockResolvedValue(undefined);
    const fadeIn2 = vi.spyOn(synth2, "fadeIn").mockResolvedValue(undefined);
    const fadeOut1 = vi.spyOn(synth1, "fadeOut").mockResolvedValue(undefined);
    const fadeOut2 = vi.spyOn(synth2, "fadeOut").mockResolvedValue(undefined);
    const stopWithFade1 = vi.spyOn(synth1, "stopWithFade").mockResolvedValue(undefined);
    const stopWithFade2 = vi.spyOn(synth2, "stopWithFade").mockResolvedValue(undefined);

    await group.fadeTo(0.4, 250, "exponential");
    await group.fadeIn(300);
    await group.fadeOut(350);
    await group.stopWithFade(400);

    expect(fadeTo1).toHaveBeenCalledWith(0.4, 250, "exponential");
    expect(fadeTo2).toHaveBeenCalledWith(0.4, 250, "exponential");
    expect(fadeIn1).toHaveBeenCalledWith(300, undefined);
    expect(fadeIn2).toHaveBeenCalledWith(300, undefined);
    expect(fadeOut1).toHaveBeenCalledWith(350, undefined);
    expect(fadeOut2).toHaveBeenCalledWith(350, undefined);
    expect(stopWithFade1).toHaveBeenCalledWith(400, undefined);
    expect(stopWithFade2).toHaveBeenCalledWith(400, undefined);
  });
});
