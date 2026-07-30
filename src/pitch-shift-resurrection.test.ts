import { AudioBuffer } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { audioContextMock, cacophony, expectPath } from "./setupTests";
import type { Sound } from "./sound";
import { WORKLETS } from "./worklets";

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

type PlaybackInternals = {
  context: unknown;
  panner: { connect: ReturnType<typeof vi.fn> };
  _effectChain: { nodes: readonly unknown[] };
};

const inspectPlayback = (playback: unknown): PlaybackInternals => playback as PlaybackInternals;

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

  it("Playback.setPitchShift builds the phase-vocoder node via buildWorkletEffect", async () => {
    sound = await cacophony.createSound(buffer);
    const fakeNode = makeFakePvNode();
    const factorySpy = vi
      .spyOn(cacophony, "buildWorkletEffect")
      .mockResolvedValue(fakeNode as unknown as Awaited<ReturnType<typeof cacophony.buildWorkletEffect>>);

    const playback = sound.preplay()[0];
    await playback.setPitchShift(2);

    expect(factorySpy).toHaveBeenCalledTimes(1);
    // routed through the phase-vocoder worklet seam with no parameterData...
    expect(factorySpy.mock.calls[0]?.[0]).toBe(WORKLETS.phaseVocoder);
    expect(factorySpy.mock.calls[0]?.[1]).toEqual({});
    // ...and the node constructed on the playback's own context (cross-context contract)
    expect(factorySpy.mock.calls[0]?.[2]).toBe(inspectPlayback(playback).context);
    expect(playback.pitchShift).toBe(2);
  });

  it("adds the phase-vocoder as a pre-panner chain entry", async () => {
    sound = await cacophony.createSound(buffer);
    const fakeNode = makeFakePvNode();
    vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue(
      fakeNode as unknown as Awaited<ReturnType<typeof cacophony.buildWorkletEffect>>,
    );

    const playback = sound.preplay()[0];
    await playback.setPitchShift(1.5);

    expect(inspectPlayback(playback)._effectChain.nodes).toContain(fakeNode);
    expectPath(playback.source!, [fakeNode, playback.panner!], playback.outputNode);
  });

  it("forwards the pitch factor to the node's pitchFactor AudioParam", async () => {
    sound = await cacophony.createSound(buffer);
    const fakeNode = makeFakePvNode();
    vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue(
      fakeNode as unknown as Awaited<ReturnType<typeof cacophony.buildWorkletEffect>>,
    );

    const playback = sound.preplay()[0];
    await playback.setPitchShift(0.5);

    expect(fakeNode.parameters.get).toHaveBeenCalledWith("pitchFactor");
    expect(fakeNode._pitchParam.value).toBe(0.5);

    // updating the factor again reaches the same param without rebuilding the node.
    await playback.setPitchShift(2);
    expect(fakeNode._pitchParam.value).toBe(2);
  });

  it("keeps the pitch node after a later filter insertion", async () => {
    sound = await cacophony.createSound(buffer);
    const fakeNode = makeFakePvNode();
    vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue(
      fakeNode as unknown as Awaited<ReturnType<typeof cacophony.buildWorkletEffect>>,
    );

    const playback = sound.preplay()[0];
    await playback.setPitchShift(1.5);
    const pitchConnectCount = fakeNode.connect.mock.calls.length;

    const filter = audioContextMock.createBiquadFilter();
    playback.addFilter(filter as unknown as Parameters<typeof playback.addFilter>[0]);

    expect(inspectPlayback(playback)._effectChain.nodes).toContain(fakeNode);
    expectPath(playback.source!, [filter, fakeNode, playback.panner!], playback.outputNode);
    expect(fakeNode.connect).toHaveBeenCalledTimes(pitchConnectCount);
  });

  it("setPitchShift(1) tears the phase-vocoder node out and bypasses it (true passthrough)", async () => {
    // Codex finding #4 (major): factor 1 is the documented "no shift" contract.
    // The peak/region pipeline does NOT guarantee identity for peakless/broadband
    // content, so factor 1 must remove the node from the graph, not just set the
    // param. We assert the node is disconnected, dropped, and the chain rebuilt
    // so the source feeds the panner directly (no pv node in between).
    sound = await cacophony.createSound(buffer);
    const fakeNode = makeFakePvNode();
    vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue(
      fakeNode as unknown as Awaited<ReturnType<typeof cacophony.buildWorkletEffect>>,
    );

    const playback = sound.preplay()[0];
    await playback.setPitchShift(1.5);
    expect(inspectPlayback(playback)._effectChain.nodes).toContain(fakeNode);

    fakeNode.disconnect.mockClear();

    await playback.setPitchShift(1);

    // node disconnected and dropped (genuine bypass, not param=1 with node live).
    expect(fakeNode.disconnect).toHaveBeenCalled();
    expect(inspectPlayback(playback)._effectChain.nodes).not.toContain(fakeNode);
    expect(playback.pitchShift).toBe(1);
    expectPath(playback.source!, [playback.panner!], playback.outputNode);
  });

  it("Sound.setPitchShift rejects invalid factors (0/NaN/negative) WITHOUT storing them", async () => {
    // Codex finding #5 (minor): with no live playbacks, Promise.all([]) resolves,
    // so an unguarded setPitchShift(0) would "succeed" and leave pitchShift
    // invalid, which preplay later swallows. Validate up front.
    sound = await cacophony.createSound(buffer);
    expect(sound.pitchShift).toBe(1);

    await expect(sound.setPitchShift(0)).rejects.toThrow();
    expect(sound.pitchShift).toBe(1); // unchanged — 0 not stored

    await expect(sound.setPitchShift(Number.NaN)).rejects.toThrow();
    expect(sound.pitchShift).toBe(1);

    await expect(sound.setPitchShift(-2)).rejects.toThrow();
    expect(sound.pitchShift).toBe(1);

    await expect(sound.setPitchShift(Number.POSITIVE_INFINITY)).rejects.toThrow();
    expect(sound.pitchShift).toBe(1);

    // a valid factor still works and IS stored.
    const fakeNode = makeFakePvNode();
    vi.spyOn(cacophony, "buildWorkletEffect").mockResolvedValue(
      fakeNode as unknown as Awaited<ReturnType<typeof cacophony.buildWorkletEffect>>,
    );
    await sound.setPitchShift(2);
    expect(sound.pitchShift).toBe(2);
  });

  it("Sound.setPitchShift fans out to live playbacks and is picked up by future playbacks", async () => {
    sound = await cacophony.createSound(buffer);
    const built: ReturnType<typeof makeFakePvNode>[] = [];
    vi.spyOn(cacophony, "buildWorkletEffect").mockImplementation(async () => {
      const node = makeFakePvNode();
      built.push(node);
      return node as unknown as Awaited<ReturnType<typeof cacophony.buildWorkletEffect>>;
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

  it("Playback.clone preserves pitch shift with its own worklet node", async () => {
    sound = await cacophony.createSound(buffer);
    const built: ReturnType<typeof makeFakePvNode>[] = [];
    vi.spyOn(cacophony, "buildWorkletEffect").mockImplementation(async () => {
      const node = makeFakePvNode();
      built.push(node);
      return node as unknown as Awaited<ReturnType<typeof cacophony.buildWorkletEffect>>;
    });

    const original = sound.preplay()[0];
    await original.setPitchShift(2);

    const clone = original.clone();
    await Promise.resolve();
    await Promise.resolve();

    expect(clone.pitchShift).toBe(original.pitchShift);
    expect(built).toHaveLength(2);
    expect(inspectPlayback(clone)._effectChain.nodes).toContain(built[1]);
    expect(inspectPlayback(clone)._effectChain.nodes).not.toContain(built[0]);
  });
});
