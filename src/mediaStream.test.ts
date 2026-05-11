import { AudioContext } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Cacophony } from "./cacophony";
import { MediaStreamPlayback, MediaStreamSound } from "./mediaStream";

function createMockTrack(): MediaStreamTrack {
  return {
    enabled: true,
    stop: vi.fn(),
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

  beforeEach(() => {
    context = new AudioContext();
    track = createMockTrack();
    stream = createMockStream([track]);
    source = createMockMediaStreamSource(stream);
    globalGainNode = context.createGain();
    vi.spyOn(context as any, "createMediaStreamSource").mockReturnValue(source);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    context.close();
  });

  it("creates one reusable playback for a live MediaStream", () => {
    const sound = new MediaStreamSound(stream, context, globalGainNode);

    const firstPlay = sound.play();
    const secondPlay = sound.play();

    expect(firstPlay).toHaveLength(1);
    expect(firstPlay[0]).toBeInstanceOf(MediaStreamPlayback);
    expect(secondPlay[0]).toBe(firstPlay[0]);
    expect(context.createMediaStreamSource).toHaveBeenCalledTimes(1);
    expect(sound.isPlaying).toBe(true);
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
});
