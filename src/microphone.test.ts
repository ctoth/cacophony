import { AudioContext } from "standardized-audio-context-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cacophony } from "./cacophony";
import { MicrophoneStream as PublicMicrophoneStream } from "./index";
import { MicrophonePlayback, MicrophoneStream } from "./microphone";
import { expectPath } from "./setupTests";

function createMockTrack(): MediaStreamTrack {
  return {
    stop: vi.fn(),
    enabled: true,
  } as unknown as MediaStreamTrack;
}

function createMockStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function createMockMediaStreamSource(stream: MediaStream) {
  return {
    connect: vi.fn().mockReturnValue({
      connect: vi.fn(),
    }),
    disconnect: vi.fn(),
    mediaStream: stream,
    numberOfInputs: 1,
    numberOfOutputs: 1,
  };
}

it("exports MicrophoneStream from the public package entrypoint", () => {
  expect(PublicMicrophoneStream).toBe(MicrophoneStream);
});

describe("MicrophonePlayback", () => {
  let context: AudioContext;
  let mockTrack: MediaStreamTrack;
  let mockStream: MediaStream;
  let mockSource: ReturnType<typeof createMockMediaStreamSource>;
  let mockGainNode: any;
  let playback: MicrophonePlayback;

  beforeEach(() => {
    context = new AudioContext();
    mockTrack = createMockTrack();
    mockStream = createMockStream([mockTrack]);
    mockSource = createMockMediaStreamSource(mockStream);
    mockGainNode = context.createGain();
    playback = new MicrophonePlayback(mockSource as any, mockGainNode, context);
  });

  afterEach(() => {
    context.close();
  });

  it("play returns array containing itself", () => {
    const result = playback.play();
    expect(result).toEqual([playback]);
  });

  it("isPlaying is true when source exists", () => {
    expect(playback.isPlaying).toBe(true);
  });

  it("stop calls track.stop() on all stream tracks", () => {
    playback.stop();
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it("pause disables all stream tracks", () => {
    playback.pause();
    expect(mockTrack.enabled).toBe(false);
  });

  it("resume enables all stream tracks", () => {
    playback.pause();
    expect(mockTrack.enabled).toBe(false);
    playback.resume();
    expect(mockTrack.enabled).toBe(true);
  });

  it("volume getter/setter works", () => {
    playback.volume = 0.5;
    expect(playback.volume).toBe(0.5);
  });

  it("position getter/setter works", () => {
    playback.position = [1, 2, 3];
    expect(playback.position).toEqual([1, 2, 3]);
  });

  it("playbackRate is always 1 (not applicable for mic)", () => {
    expect(playback.playbackRate).toBe(1);
    playback.playbackRate = 2;
    expect(playback.playbackRate).toBe(1);
  });

  it("duration is always 0", () => {
    expect(playback.duration).toBe(0);
  });
});

describe("MicrophoneStream", () => {
  let context: AudioContext;
  let mockTrack: MediaStreamTrack;
  let mockStream: MediaStream;

  beforeEach(() => {
    context = new AudioContext();
    mockTrack = createMockTrack();
    mockStream = createMockStream([mockTrack]);

    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(global, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(),
        },
      },
      writable: true,
      configurable: true,
    });

    // Mock createMediaStreamSource on the context
    vi.spyOn(context as any, "createMediaStreamSource").mockReturnValue(createMockMediaStreamSource(mockStream));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    context.close();
  });

  it("play() returns playback immediately when constructed with a stream", () => {
    const mic = new MicrophoneStream(context, mockStream);
    const result = mic.play();
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(MicrophonePlayback);
  });

  it("play() returns empty array and calls getUserMedia when constructed without a stream", () => {
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream);
    const mic = new MicrophoneStream(context);
    const result = mic.play();
    expect(result).toEqual([]);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("play() sets up streamPlayback after getUserMedia resolves (no-stream path)", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream);
    const mic = new MicrophoneStream(context);
    mic.play();

    // Wait for async setup
    await vi.waitFor(() => {
      expect(mic.isPlaying).toBe(true);
    });

    // Second call should return the playback
    const result = mic.play();
    expect(result).toHaveLength(1);
  });

  it("handles getUserMedia permission denial", async () => {
    const permissionError = new DOMException("Permission denied", "NotAllowedError");
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(permissionError);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mic = new MicrophoneStream(context);
    mic.play();

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("Error initializing microphone stream:", permissionError);
    });

    expect(mic.isPlaying).toBe(false);
    consoleSpy.mockRestore();
  });

  it("does not call getUserMedia when constructed with a stream", () => {
    const mic = new MicrophoneStream(context, mockStream);
    mic.play();
    mic.play();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("stop() delegates to streamPlayback and clears it", () => {
    const mic = new MicrophoneStream(context, mockStream);
    mic.play();
    expect(mic.isPlaying).toBe(true);

    mic.stop();
    expect(mic.isPlaying).toBe(false);
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it("pause() delegates to streamPlayback", () => {
    const mic = new MicrophoneStream(context, mockStream);
    mic.play();

    mic.pause();
    expect(mockTrack.enabled).toBe(false);
  });

  it("resume() delegates to streamPlayback", () => {
    const mic = new MicrophoneStream(context, mockStream);
    mic.play();

    mic.pause();
    mic.resume();
    expect(mockTrack.enabled).toBe(true);
  });

  it("stop/pause/resume are no-ops when no stream acquired", () => {
    const mic = new MicrophoneStream(context);
    // None of these should throw
    mic.stop();
    mic.pause();
    mic.resume();
    expect(mic.isPlaying).toBe(false);
  });

  it("duration is always 0", () => {
    const mic = new MicrophoneStream(context);
    expect(mic.duration).toBe(0);
  });

  it("loop always returns 0", () => {
    const mic = new MicrophoneStream(context);
    expect(mic.loop()).toBe(0);
    expect(mic.loop(5)).toBe(0);
  });

  it("playbackRate is always 1", () => {
    const mic = new MicrophoneStream(context);
    expect(mic.playbackRate).toBe(1);
    mic.playbackRate = 2;
    expect(mic.playbackRate).toBe(1);
  });

  it("connects the internal microphoneGainNode to the provided outputNode", () => {
    // Regression test for routing bug: MicrophoneStream previously created
    // a microphoneGainNode that was never connected to anything downstream,
    // so volume/mute on the chain were inaudible. The fix wires the gain
    // node through an optional outputNode in the constructor.
    // See notes/scout-routing-graph.md ("MicrophonePlayback" / dangling
    // gain node observation).
    const outputNode = context.createGain();
    const microphone = new MicrophoneStream(context, mockStream, outputNode);
    const microphoneGainNode = (
      microphone as unknown as {
        microphoneGainNode: GainNode;
      }
    ).microphoneGainNode;

    expectPath(microphoneGainNode, [], outputNode);
  });

  it.skip("routes Cacophony microphone monitoring through the master bus (#102)", async () => {
    (navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream);
    const cacophony = new Cacophony(context as any);

    const microphone = await cacophony.getMicrophoneStream();
    const microphoneGainNode = (
      microphone as unknown as {
        microphoneGainNode: GainNode;
      }
    ).microphoneGainNode;

    expectPath(microphoneGainNode, [], cacophony.master.input);
  });
});
