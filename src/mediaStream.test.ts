import { AudioContext } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Cacophony } from "./cacophony";
import { MediaStreamPlayback, MediaStreamSound } from "./mediaStream";
import { expectNotReachable, expectPath, expectReachable } from "./setupTests";

function createMockTrack(): MediaStreamTrack {
  let readyState: MediaStreamTrackState = "live";
  return {
    enabled: true,
    get readyState() {
      return readyState;
    },
    stop: vi.fn(() => {
      readyState = "ended";
    }),
  } as unknown as MediaStreamTrack;
}

function createMockStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function createMockMediaStreamSource(stream: MediaStream) {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    mediaStream: stream,
    numberOfInputs: 1,
    numberOfOutputs: 1,
  };
}

describe("MediaStreamSound", () => {
  let context: AudioContext;
  let track: MediaStreamTrack;
  let stream: MediaStream;
  let source: ReturnType<typeof createMockMediaStreamSource>;
  let globalGainNode: ReturnType<AudioContext["createGain"]>;
  let destination: AudioContext["destination"];

  beforeEach(() => {
    context = new AudioContext();
    track = createMockTrack();
    stream = createMockStream([track]);
    source = createMockMediaStreamSource(stream);
    globalGainNode = context.createGain();
    destination = context.destination;
    globalGainNode.connect(destination);
    vi.spyOn(context as any, "createMediaStreamSource").mockReturnValue(source);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    context.close();
  });

  it("creates one reusable playback for a live MediaStream", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode);
    sound.addFilter(context.createBiquadFilter());

    const firstPlay = sound.play();
    const secondPlay = sound.play();

    expect(firstPlay).toHaveLength(1);
    expect(firstPlay[0]).toBeInstanceOf(MediaStreamPlayback);
    expect(secondPlay[0]).toBe(firstPlay[0]);
    expect(context.createMediaStreamSource).toHaveBeenCalledTimes(1);
    expect(sound.isPlaying).toBe(true);
    expectPath(
      source,
      [firstPlay[0].filters[0], firstPlay[0].panner!, firstPlay[0].outputNode, globalGainNode],
      destination,
    );
  });

  it("applies volume and HRTF position to the live playback", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode);
    sound.volume = 0.25;
    sound.position = [1, 2, 3];

    const [playback] = sound.play();

    expect(playback.volume).toBe(0.25);
    expect(playback.position).toEqual([1, 2, 3]);
  });

  it("can leave externally owned tracks running when stopped", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode, {
      stopTracksOnStop: false,
    });

    sound.play();
    sound.stop();

    expect(track.stop).not.toHaveBeenCalled();
    expect(source.disconnect).toHaveBeenCalled();
    expect(sound.isPlaying).toBe(false);
  });

  it("stops owned tracks by default", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode);

    sound.play();
    sound.stop();

    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("throws when replaying after the default stop ends every track", () => {
    const cacophony = new Cacophony(context as any);
    vi.spyOn(context as any, "createMediaStreamSource").mockReturnValue(source);
    const sound = cacophony.createMediaStreamSound(stream, {
      primeWithMediaElement: false,
    });

    sound.play();
    sound.stop();

    expect(() => sound.play()).toThrow("Cannot play a media stream whose tracks have ended");
  });

  it("pauses and resumes by toggling track enabled state", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode, {
      stopTracksOnStop: false,
    });

    sound.play();
    sound.pause();
    expect(track.enabled).toBe(false);

    sound.resume();
    expect(track.enabled).toBe(true);
  });

  it("emits global playback events through the owning Cacophony instance", () => {
    const cacophony = new Cacophony(context as any);
    vi.spyOn(context as any, "createMediaStreamSource").mockReturnValue(source);
    const sound = cacophony.createMediaStreamSound(stream, {
      stopTracksOnStop: false,
    });
    const events: string[] = [];

    cacophony.on("globalPlay", () => events.push("play"));
    cacophony.on("globalPause", () => events.push("pause"));
    cacophony.on("globalStop", () => events.push("stop"));

    sound.play();
    sound.pause();
    sound.stop();

    expect(sound).toBeInstanceOf(MediaStreamSound);
    expect(events).toEqual(["play", "pause", "stop"]);
  });

  it("routes a live stream through a bus via the public Cacophony API", () => {
    const cacophony = new Cacophony(context as any);
    vi.spyOn(context as any, "createMediaStreamSource").mockReturnValue(source);
    const sound = cacophony.createMediaStreamSound(stream, {
      primeWithMediaElement: false,
      stopTracksOnStop: false,
    });
    const bus = cacophony.createBus("media-stream-route");
    bus.disconnect(cacophony.master);
    const [playback] = sound.play();

    sound.routeTo(bus);

    expectPath(playback.outputNode, [], bus.input);
    expectReachable(source, bus.output);
    expectNotReachable(playback.outputNode, cacophony.master.input);

    sound.cleanup();
    bus.destroy();
  });
});

interface MockPrimeElement {
  muted: boolean;
  srcObject: MediaStream | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

describe("MediaStreamSound Chromium priming", () => {
  let context: AudioContext;
  let track: MediaStreamTrack;
  let stream: MediaStream;
  let source: ReturnType<typeof createMockMediaStreamSource>;
  let globalGainNode: ReturnType<AudioContext["createGain"]>;
  let createdElements: MockPrimeElement[];
  let originalAudio: typeof globalThis.Audio | undefined;

  beforeEach(() => {
    context = new AudioContext();
    track = createMockTrack();
    stream = createMockStream([track]);
    source = createMockMediaStreamSource(stream);
    globalGainNode = context.createGain();
    vi.spyOn(context as any, "createMediaStreamSource").mockReturnValue(source);

    createdElements = [];
    originalAudio = (globalThis as any).Audio;
    (globalThis as any).Audio = vi.fn().mockImplementation(function MockAudio() {
      const element: MockPrimeElement = {
        muted: false,
        srcObject: null,
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
      };
      createdElements.push(element);
      return element;
    });
  });

  afterEach(() => {
    (globalThis as any).Audio = originalAudio;
    vi.restoreAllMocks();
    context.close();
  });

  it("primes Chromium with a muted media element carrying the stream on play", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode, {
      stopTracksOnStop: false,
    });

    sound.play();

    expect(createdElements).toHaveLength(1);
    const element = createdElements[0];
    expect(element.muted).toBe(true);
    expect(element.srcObject).toBe(stream);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it("pauses the prime element when the stream pauses", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode, {
      stopTracksOnStop: false,
    });

    sound.play();
    sound.pause();

    expect(createdElements[0].pause).toHaveBeenCalledOnce();
  });

  it("tears down the prime element on stop", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode, {
      stopTracksOnStop: false,
    });

    sound.play();
    const element = createdElements[0];
    sound.stop();

    expect(element.pause).toHaveBeenCalled();
    expect(element.srcObject).toBeNull();
  });

  it("does not create a prime element when priming is disabled", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode, {
      primeWithMediaElement: false,
    });

    sound.play();

    expect(createdElements).toHaveLength(0);
    expect(sound.isPlaying).toBe(true);
  });
});
