import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { audioContextMock, cacophony } from "./setupTests";
import type { Sound } from "./sound";

/**
 * Resurrection integration tests for the phase-vocoder pitch-shifter.
 *
 * The phase-vocoder worklet (Jean Laroche & Mark Dolson, "New Phase-Vocoder
 * Techniques for Pitch-Shifting, Harmonizing and Other Exotic Effects", 1999
 * IEEE WASPAA) was registered/loaded but NEVER inserted into any playback
 * graph and NEVER exposed to callers (dead code). These tests are the proof it
 * now lives: setting a pitch shift on a Sound/Playback must (a) build the
 * phase-vocoder AudioWorkletNode via the sanctioned factory, (b) splice that
 * node into the live playback graph (panner/filter-tail → pvNode → gainNode),
 * and (c) forward the pitch factor to the node's `pitchFactor` AudioParam.
 */

/** Install a stub `audioWorklet.addModule` on the mock context (it has none by default). */
function mockAudioWorklet() {
  const addModule = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(audioContextMock, "audioWorklet", {
    value: { addModule },
    writable: true,
    configurable: true,
  });
  return addModule;
}

/**
 * Build a fake phase-vocoder worklet node that records connect targets and
 * carries a spy-able `pitchFactor` param. Returned from the factory spy so the
 * test can inspect graph insertion and param forwarding without a real audio
 * thread.
 */
function makeFakePvNode() {
  const pitchParam = { value: 1 };
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    port: { postMessage: vi.fn(), addEventListener: vi.fn() },
    parameters: { get: vi.fn((name: string) => (name === "pitchFactor" ? pitchParam : undefined)) },
    _pitchParam: pitchParam,
  };
}

describe("phase-vocoder resurrection: pitch-shift wires the dead worklet into the graph", () => {
  let buffer: AudioBuffer;
  let sound: Sound;

  beforeEach(() => {
    mockAudioWorklet();
    buffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Playback.setPitchShift builds the phase-vocoder node via createPhaseVocoderNode", async () => {
    sound = await cacophony.createSound(buffer);
    const fakeNode = makeFakePvNode();
    const factorySpy = vi
      .spyOn(cacophony, "createPhaseVocoderNode")
      .mockResolvedValue(fakeNode as unknown as Awaited<ReturnType<typeof cacophony.createPhaseVocoderNode>>);

    const playback = sound.preplay()[0];
    await playback.setPitchShift(2);

    expect(factorySpy).toHaveBeenCalledTimes(1);
    // node constructed on the playback's own context (cross-context contract)
    expect(factorySpy.mock.calls[0]?.[1]).toBe(playback["context"]);
    expect(playback.pitchShift).toBe(2);
  });

  it("splices the phase-vocoder node into the graph: filterTail/panner → pvNode → gainNode", async () => {
    sound = await cacophony.createSound(buffer);
    const fakeNode = makeFakePvNode();
    vi.spyOn(cacophony, "createPhaseVocoderNode").mockResolvedValue(
      fakeNode as unknown as Awaited<ReturnType<typeof cacophony.createPhaseVocoderNode>>,
    );

    const playback = sound.preplay()[0];
    // With no filters, the panner is the chain tail feeding the pitch node.
    const panner = playback["panner"] as { connect: ReturnType<typeof vi.fn> };
    const pannerConnectSpy = vi.spyOn(panner, "connect");

    await playback.setPitchShift(1.5);

    // panner now connects INTO the phase-vocoder node (not straight to gainNode).
    expect(pannerConnectSpy).toHaveBeenCalledWith(fakeNode);
    // and the phase-vocoder node connects OUT to the playback's gainNode.
    expect(fakeNode.connect).toHaveBeenCalledWith(playback.outputNode);
  });

  it("forwards the pitch factor to the node's pitchFactor AudioParam", async () => {
    sound = await cacophony.createSound(buffer);
    const fakeNode = makeFakePvNode();
    vi.spyOn(cacophony, "createPhaseVocoderNode").mockResolvedValue(
      fakeNode as unknown as Awaited<ReturnType<typeof cacophony.createPhaseVocoderNode>>,
    );

    const playback = sound.preplay()[0];
    await playback.setPitchShift(0.5);

    expect(fakeNode.parameters.get).toHaveBeenCalledWith("pitchFactor");
    expect(fakeNode._pitchParam.value).toBe(0.5);

    // updating the factor again reaches the same param without rebuilding the node.
    await playback.setPitchShift(2);
    expect(fakeNode._pitchParam.value).toBe(2);
  });

  it("the pitch node survives a later refreshFilters rebuild (never bypassed)", async () => {
    sound = await cacophony.createSound(buffer);
    const fakeNode = makeFakePvNode();
    vi.spyOn(cacophony, "createPhaseVocoderNode").mockResolvedValue(
      fakeNode as unknown as Awaited<ReturnType<typeof cacophony.createPhaseVocoderNode>>,
    );

    const playback = sound.preplay()[0];
    await playback.setPitchShift(1.5);
    fakeNode.connect.mockClear();

    // Adding a filter triggers refreshFilters — the pitch node must be re-inserted.
    const filter = audioContextMock.createBiquadFilter();
    playback.addFilter(filter as unknown as Parameters<typeof playback.addFilter>[0]);

    // pitch node still connects out to gainNode after the rebuild.
    expect(fakeNode.connect).toHaveBeenCalledWith(playback.outputNode);
  });

  it("Sound.setPitchShift fans out to live playbacks and is picked up by future playbacks", async () => {
    sound = await cacophony.createSound(buffer);
    const built: ReturnType<typeof makeFakePvNode>[] = [];
    vi.spyOn(cacophony, "createPhaseVocoderNode").mockImplementation(async () => {
      const node = makeFakePvNode();
      built.push(node);
      return node as unknown as Awaited<ReturnType<typeof cacophony.createPhaseVocoderNode>>;
    });

    // one live playback BEFORE setting the shift
    const existing = sound.preplay()[0];

    await sound.setPitchShift(2);
    expect(sound.pitchShift).toBe(2);
    expect(existing.pitchShift).toBe(2);
    expect(built.length).toBe(1); // built for the existing playback

    // a future playback inherits the factor (preplay fire-and-forget)
    const future = sound.preplay()[0];
    // allow the fire-and-forget setPitchShift microtask to settle
    await Promise.resolve();
    await Promise.resolve();
    expect(future.pitchShift).toBe(2);
    expect(built.length).toBe(2);
  });
});
