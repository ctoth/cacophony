import { describe, expect, it } from "vitest";
import { audioContextMock, expectNotReachable, expectPath, expectReachable, graphSnapshot } from "./setupTests";

describe("audio graph assertions", () => {
  it("asserts reachability and an exact ordered path", () => {
    const source = audioContextMock.createGain();
    const panner = audioContextMock.createStereoPanner();
    const filter = audioContextMock.createBiquadFilter();
    const gain = audioContextMock.createGain();
    const destination = audioContextMock.destination;

    source.connect(panner);
    panner.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    expectReachable(source, destination);
    expectPath(source, [panner, filter, gain], destination);
    expectNotReachable(destination, source);
  });

  it("removes destination-specific and blanket-disconnected edges", () => {
    const source = audioContextMock.createGain();
    const first = audioContextMock.createGain();
    const second = audioContextMock.createGain();

    source.connect(first);
    source.connect(second);
    source.disconnect(first);

    expectNotReachable(source, first);
    expectReachable(source, second);

    source.disconnect();

    expectNotReachable(source, second);
  });

  it("distinguishes splitter and merger port overloads", () => {
    const splitter = audioContextMock.createChannelSplitter(2);
    const merger = audioContextMock.createChannelMerger(2);

    splitter.connect(merger, 0, 1);
    splitter.connect(merger, 1, 0);
    splitter.disconnect(merger, 0, 1);

    expectReachable(splitter, merger);
    expect(graphSnapshot(splitter)).toEqual({
      nodes: [
        { id: "n0", type: "ChannelSplitterNodeMock" },
        { id: "n1", type: "ChannelMergerNodeMock" },
      ],
      edges: [{ source: "n0", destination: "n1", output: 1, input: 0 }],
    });
  });

  it("records Vitest-mocked AudioWorkletNode connections", () => {
    const worklet = new AudioWorkletNode(audioContextMock as unknown as BaseAudioContext, "test-processor");
    const destination = audioContextMock.createGain();

    worklet.connect(destination as unknown as globalThis.AudioNode);

    expectReachable(worklet, destination);
    expect(JSON.parse(JSON.stringify(graphSnapshot(worklet)))).toEqual(graphSnapshot(worklet));
  });
});
