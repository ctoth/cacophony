import { describe, expect, it, vi } from "vitest";
import { cacophony, expectPath } from "./setupTests";

describe("SynthPlayback: outputNode / connect / disconnect parity with Playback", () => {
  it("emits playback and global events across play, pause, resume, and stop", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.preplay();
    const playbackEvents: string[] = [];
    const globalEvents: string[] = [];

    playback.on("play", () => playbackEvents.push("play"));
    playback.on("pause", () => playbackEvents.push("pause"));
    playback.on("resume", () => playbackEvents.push("resume"));
    playback.on("stop", () => playbackEvents.push("stop"));
    cacophony.on("globalPlay", ({ source }) => {
      expect(source).toBe(synth);
      globalEvents.push("play");
    });
    cacophony.on("globalPause", ({ source }) => {
      expect(source).toBe(synth);
      globalEvents.push("pause");
    });
    cacophony.on("globalStop", ({ source }) => {
      expect(source).toBe(synth);
      globalEvents.push("stop");
    });

    playback.play();
    playback.pause();
    playback.play();
    playback.stop();

    expect(playbackEvents).toEqual(["play", "pause", "play", "resume", "stop"]);
    expect(globalEvents).toEqual(["play", "pause", "play", "stop"]);
  });

  it("exposes outputNode (a GainNode) on a live synth playback", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    expect(playback.outputNode).toBeDefined();
    // outputNode should be a GainNode (has .gain.value).
    expect((playback.outputNode as unknown as { gain: { value: number } }).gain.value).toBeDefined();
    expectPath(playback.source!, [playback.panner!, playback.outputNode], cacophony.master.input);
    synth.stop();
  });

  it("connect(target) delegates to outputNode.connect", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    const target = cacophony.context.createGain();
    const spy = vi.spyOn(playback.outputNode, "connect");
    playback.connect(target);
    expect(spy).toHaveBeenCalledWith(target);
    synth.stop();
  });

  it("disconnect() with no args delegates to outputNode.disconnect()", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    const spy = vi.spyOn(playback.outputNode, "disconnect");
    playback.disconnect();
    expect(spy).toHaveBeenCalledWith();
    synth.stop();
  });

  it("disconnect(target) delegates to outputNode.disconnect(target)", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    const target = cacophony.context.createGain();
    playback.connect(target);
    const spy = vi.spyOn(playback.outputNode, "disconnect");
    playback.disconnect(target);
    expect(spy).toHaveBeenCalledWith(target);
    synth.stop();
  });

  it("connects and disconnects AudioParam targets", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    const target = cacophony.createBiquadFilter({ frequency: 440 }).frequency;
    const connectSpy = vi.spyOn(playback.outputNode, "connect");
    playback.connect(target);
    expect(connectSpy).toHaveBeenCalledWith(target);

    const disconnectSpy = vi.spyOn(playback.outputNode, "disconnect");
    playback.disconnect(target);
    expect(disconnectSpy).toHaveBeenCalledWith(target);
    synth.stop();
  });

  it("outputNode returns the same GainNode across calls", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    const node = playback.outputNode;
    expect(playback.outputNode).toBe(node);
    synth.stop();
  });

  it("connect returns the destination node (for chaining)", () => {
    const synth = cacophony.createOscillator({});
    const [playback] = synth.play();
    const target = cacophony.context.createGain();
    const returned = playback.connect(target);
    // Web Audio convention: connect(destination) returns the destination.
    expect(returned).toBe(target);
    synth.stop();
  });
});
