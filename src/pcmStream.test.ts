import { beforeEach, describe, expect, it, vi } from "vitest";

import { PcmStreamPlayback, PcmStreamSound } from "./pcmStream";
import { audioContextMock, cacophony, expectNotReachable, expectPath, expectReachable } from "./setupTests";
import { WORKLETS } from "./worklets";

function mockAudioWorklet(): void {
  Object.defineProperty(audioContextMock, "audioWorklet", {
    value: { addModule: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
}

function messageListener(node: PcmStreamPlayback["source"]): (event: MessageEvent) => void {
  const addEventListener = vi.mocked(node!.port.addEventListener);
  const registration = addEventListener.mock.calls.find(([type]) => type === "message");
  if (!registration) {
    throw new Error("PCM stream did not register a worklet message listener");
  }
  return registration[1] as (event: MessageEvent) => void;
}

describe("PcmStreamSound", () => {
  beforeEach(() => {
    mockAudioWorklet();
  });

  it("constructs the PCM worklet through the public Cacophony factory", async () => {
    const createNode = vi.spyOn(cacophony, "createWorkletNode");

    const sound = await cacophony.createPcmStreamSound({
      channelCount: 2,
      bufferDuration: 0.5,
      latency: 0.05,
    });

    expect(sound).toBeInstanceOf(PcmStreamSound);
    expect(createNode).toHaveBeenCalledWith(WORKLETS.pcmStream.name, WORKLETS.pcmStream.url, undefined, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: {
        capacityFrames: Math.ceil(audioContextMock.sampleRate * 0.5),
        channelCount: 2,
        latencyFrames: Math.ceil(audioContextMock.sampleRate * 0.05),
      },
    });
  });

  it("routes volume and stereo pan through the existing RoutableSource path", async () => {
    const sound = await cacophony.createPcmStreamSound({
      panType: "stereo",
      latency: 0,
    });
    const bus = cacophony.createBus("pcm-route");
    bus.disconnect(cacophony.master);
    sound.routeTo(bus);
    sound.volume = 0.25;
    sound.stereoPan = -0.5;
    sound.addFilter(cacophony.createBiquadFilter({ frequency: 800 }));

    const [playback] = sound.play();

    expect(playback).toBeInstanceOf(PcmStreamPlayback);
    expect(playback.volume).toBe(0.25);
    expect(playback.stereoPan).toBe(-0.5);
    expect(playback.filters).toHaveLength(1);
    expectPath(playback.source!, [playback.filters[0], playback.panner!, playback.outputNode], bus.input);
    expectReachable(playback.source!, bus.output);
    expectNotReachable(playback.outputNode, cacophony.master.input);
  });

  it("builds source effects before the PCM playback panner", async () => {
    const sound = await cacophony.createPcmStreamSound({ latency: 0 });
    const effect = audioContextMock.createGain();
    sound.addEffect({ build: () => effect });

    const [playback] = sound.preplay();

    expectPath(playback.source!, [effect, playback.panner!, playback.outputNode], cacophony.master.input);
  });

  it("accepts interleaved PCM, exposes buffered duration, and signals drain after backpressure", async () => {
    const capacityFrames = 4;
    const sound = await cacophony.createPcmStreamSound({
      bufferDuration: capacityFrames / audioContextMock.sampleRate,
      latency: 0,
    });
    const [playback] = sound.play();
    const drains: number[] = [];
    sound.on("drain", ({ bufferedDuration }) => drains.push(bufferedDuration));

    expect(sound.write(new Float32Array([1, 2, 3, 4]))).toBe(false);
    expect(sound.bufferedDuration).toBeCloseTo(capacityFrames / audioContextMock.sampleRate);
    expect(playback.source!.port.postMessage).toHaveBeenCalledWith({
      type: "write",
      samples: expect.any(Float32Array),
    });

    messageListener(playback.source!)({
      data: { type: "consumed", frames: 2 },
    } as MessageEvent);

    expect(sound.bufferedDuration).toBeCloseTo(2 / audioContextMock.sampleRate);
    expect(drains).toEqual([2 / audioContextMock.sampleRate]);
  });

  it("emits state, underrun, and ended events from worklet state changes", async () => {
    const sound = await cacophony.createPcmStreamSound({ latency: 0 });
    const states: string[] = [];
    const events: string[] = [];
    sound.on("stateChange", (state) => states.push(state));
    sound.on("underrun", () => events.push("underrun"));
    sound.on("ended", () => events.push("ended"));

    const [playback] = sound.play();
    sound.pause();
    sound.resume();
    sound.end();
    const receive = messageListener(playback.source!);
    receive({ data: { type: "underrun" } } as MessageEvent);
    receive({ data: { type: "ended" } } as MessageEvent);

    expect(states).toEqual(["playing", "paused", "playing", "ended"]);
    expect(events).toEqual(["underrun", "ended"]);
    expect(sound.isPlaying).toBe(false);
    expect(() => sound.play()).toThrow("Cannot play a PCM stream after it has ended");
  });

  it("emits the playback event contract across play, pause, resume, and stop", async () => {
    const sound = await cacophony.createPcmStreamSound({ latency: 0 });
    const [playback] = sound.preplay();
    const events: string[] = [];
    playback.on("play", () => events.push("play"));
    playback.on("pause", () => events.push("pause"));
    playback.on("resume", () => events.push("resume"));
    playback.on("stop", () => events.push("stop"));

    sound.play();
    sound.pause();
    sound.resume();
    sound.stop();

    expect(events).toEqual(["play", "pause", "play", "resume", "stop"]);
  });

  it("documents unsupported seek and loop operations with explicit errors", async () => {
    const sound = await cacophony.createPcmStreamSound();

    expect(() => sound.seek(1)).toThrow("PCM streams do not support seeking");
    expect(() => sound.loop()).toThrow("PCM streams do not support looping");
  });

  it("tears down the worklet when its AbortSignal aborts", async () => {
    const controller = new AbortController();
    const sound = await cacophony.createPcmStreamSound({
      signal: controller.signal,
    });
    const [playback] = sound.play();
    const source = playback.source!;

    controller.abort();

    expect(source.port.postMessage).toHaveBeenCalledWith({ type: "stop" });
    expect(source.disconnect).toHaveBeenCalled();
    expect(sound.isPlaying).toBe(false);
  });
});
