import { AudioContext } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cacophony } from "./cacophony";
import { MicrophonePlayback as PublicMicrophonePlayback, MicrophoneStream as PublicMicrophoneStream } from "./index";
import { MicrophonePlayback, MicrophoneStream } from "./microphone";
import { expectNotReachable, expectPath, expectReachable } from "./setupTests";

function createMockTrack(): MediaStreamTrack {
  return {
    stop: vi.fn(),
    enabled: true,
    readyState: "live",
  } as unknown as MediaStreamTrack;
}

function createMockStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function createMockMediaStreamSource(stream: MediaStream) {
  return {
    connect: vi.fn((destination) => destination),
    disconnect: vi.fn(),
    mediaStream: stream,
    numberOfInputs: 1,
    numberOfOutputs: 1,
  };
}

it("exports the microphone classes from the public package entrypoint", () => {
  expect(PublicMicrophoneStream).toBe(MicrophoneStream);
  expect(PublicMicrophonePlayback).toBe(MicrophonePlayback);
});

describe("MicrophoneStream", () => {
  let context: AudioContext;
  let mockTrack: MediaStreamTrack;
  let mockStream: MediaStream;

  beforeEach(() => {
    context = new AudioContext();
    mockTrack = createMockTrack();
    mockStream = createMockStream([mockTrack]);

    Object.defineProperty(global, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(),
        },
      },
      writable: true,
      configurable: true,
    });

    vi.spyOn(context as any, "createMediaStreamSource").mockImplementation((stream: MediaStream) =>
      createMockMediaStreamSource(stream),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    context.close();
  });

  it("acquires audio with the default constraints", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream);

    const microphone = await MicrophoneStream.request(context);

    expect(microphone).toBeInstanceOf(MicrophoneStream);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("forwards custom media constraints", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream);
    const constraints: MediaStreamConstraints = {
      audio: { autoGainControl: false, echoCancellation: false },
    };

    await MicrophoneStream.request(context, undefined, { constraints });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(constraints);
  });

  it("rejects microphone acquisition failures through the async factory", async () => {
    const permissionError = new DOMException("Permission denied", "NotAllowedError");
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(permissionError);
    const cacophony = new Cacophony(context as any);

    await expect(cacophony.getMicrophoneStream()).rejects.toBe(permissionError);
  });

  it("does not reacquire a provided stream", () => {
    const microphone = new MicrophoneStream(context, mockStream);

    microphone.play();

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("uses the BasePlayback state machine and lifecycle events", () => {
    const microphone = new MicrophoneStream(context, mockStream);
    const [playback] = microphone.preplay();
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onStop = vi.fn();
    playback.on("play", onPlay);
    playback.on("pause", onPause);
    playback.on("stop", onStop);

    expect(playback.isPlaying).toBe(false);
    expect(playback.play()).toEqual([playback]);
    expect(playback).toBeInstanceOf(MicrophonePlayback);
    expect(playback.isPlaying).toBe(true);
    playback.pause();
    expect(playback.isPaused).toBe(true);
    expect(mockTrack.enabled).toBe(false);
    playback.resume();
    expect(playback.isPlaying).toBe(true);
    expect(mockTrack.enabled).toBe(true);
    playback.stop();
    expect(playback.isPlaying).toBe(false);

    expect(onPlay).toHaveBeenCalledTimes(2);
    expect(onPause).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("keeps one playback for the live microphone stream", () => {
    const microphone = new MicrophoneStream(context, mockStream);

    const first = microphone.play();
    const second = microphone.play();

    expect(second[0]).toBe(first[0]);
    expect(microphone.playbacks).toHaveLength(1);
  });

  it("rejects scheduled starts before creating microphone playback state", () => {
    const microphone = new MicrophoneStream(context, mockStream);

    expect(() => microphone.play({ at: 1 })).toThrow("Scheduled playback is only supported for buffer sounds");
    expect(microphone.playbacks).toEqual([]);
  });

  it("supports HRTF options", () => {
    const microphone = new MicrophoneStream(context, mockStream, undefined, {
      panType: "HRTF",
      threeDOptions: { positionX: 4, positionY: 2, positionZ: -1 },
    });

    expect(microphone.position).toEqual([4, 2, -1]);
    const [playback] = microphone.play();

    expect(playback.panType).toBe("HRTF");
    expect(playback.position).toEqual([4, 2, -1]);
  });

  it("supports configurable stereo panning", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream);
    const cacophony = new Cacophony(context as any);

    const microphone = await cacophony.getMicrophoneStream({
      panType: "stereo",
      stereoPan: -0.25,
    });
    const [playback] = microphone.play();

    expect(playback.panType).toBe("stereo");
    expect(playback.stereoPan).toBe(-0.25);
  });

  it("routes Cacophony microphone monitoring through the master bus (#102)", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream);
    const cacophony = new Cacophony(context as any);

    const microphone = await cacophony.getMicrophoneStream();
    const [playback] = microphone.play();

    expectPath(playback.outputNode, [], cacophony.master.input);
    expectReachable(playback.source!, cacophony.master.input);
    cacophony.mute();
    expect(cacophony.master.input.gain.value).toBe(0);
  });

  it("routes a directly constructed microphone to its provided output", () => {
    const outputNode = context.createGain();
    const microphone = new MicrophoneStream(context, mockStream, outputNode);

    const [playback] = microphone.play();

    expectPath(playback.outputNode, [], outputNode);
  });

  it("stop tears down the graph, tracks, and playback state", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream);
    const cacophony = new Cacophony(context as any);
    const microphone = await cacophony.getMicrophoneStream();
    const [playback] = microphone.play();
    const source = playback.source!;

    expectReachable(source, cacophony.master.input);
    microphone.stop();

    expectNotReachable(source, cacophony.master.input);
    expect(microphone.playbacks).toEqual([]);
    expect(mockTrack.stop).toHaveBeenCalledOnce();
  });

  it("can keep microphone tracks live across stop when configured", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream);
    const cacophony = new Cacophony(context as any);
    const microphone = await cacophony.getMicrophoneStream({
      stopTracksOnStop: false,
    });

    microphone.play();
    microphone.stop();
    const [restartedPlayback] = microphone.play();

    expect(mockTrack.stop).not.toHaveBeenCalled();
    expect(restartedPlayback.isPlaying).toBe(true);
  });

  it("retains live-stream duration, loop, and playback-rate contracts", () => {
    const microphone = new MicrophoneStream(context, mockStream);
    const [playback] = microphone.play();

    expect(playback.duration).toBe(0);
    expect(microphone.loop(4)).toBe(0);
    expect(microphone.playbackRate).toBe(1);
    microphone.playbackRate = 2;
    expect(microphone.playbackRate).toBe(1);
  });
});
