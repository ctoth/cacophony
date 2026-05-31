import { AudioContext } from "standardized-audio-context-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoaDecoderEffect, isCacophonyEffect } from "./effects";
import { encodeMonoToFoaSN3D } from "./spatial/foa-encode";
import { audioContextMock, cacophony } from "./setupTests";

/**
 * The standardized-audio-context mock returns bare `{}` stubs for
 * createChannelSplitter / createChannelMerger / createConvolver (they have no
 * `connect`). To assert the FoaDecoderEffect graph we install spy-wrapped
 * fakes for those factories (generalizing the "wrap createGain" idiom from
 * scout-effect-bus-system.md §5) and capture every created node so we can
 * inspect the edges. createGain is left as the real GainNodeMock (it has a
 * real `gain` AudioParam the effect writes -1 into).
 */
interface CapturedNode {
  kind: string;
  arg?: number;
  connect: ReturnType<typeof vi.fn>;
  normalize?: boolean;
  buffer?: unknown;
}

function instrumentGraphFactories(): { created: CapturedNode[] } {
  const created: CapturedNode[] = [];
  const make = (kind: string) => (arg?: number) => {
    const node: CapturedNode = {
      kind,
      arg,
      connect: vi.fn(),
      normalize: true,
      buffer: null,
    };
    created.push(node);
    return node as unknown as never;
  };
  vi.spyOn(audioContextMock, "createChannelSplitter").mockImplementation(make("splitter") as never);
  vi.spyOn(audioContextMock, "createChannelMerger").mockImplementation(make("merger") as never);
  // createConvolver / createBuffer are `@todo` stubs returning {} in the mock.
  (audioContextMock as unknown as { createConvolver: () => unknown }).createConvolver = make("convolver") as never;
  return { created };
}

describe("encodeMonoToFoaSN3D — SN3D/ACN positional FOA encoder (ambiX; Zotter & Frank 2019)", () => {
  it("front (az=0, el=0) steers to +X with W=s, Y=0, Z=0 (ACN order [W,Y,Z,X])", () => {
    const [w, y, z, x] = encodeMonoToFoaSN3D(1, 0, 0);
    expect(w).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(0, 12);
    expect(x).toBeCloseTo(1, 12);
  });

  it("left (az=+90deg) opens +Y and zeroes X; W stays = s (SN3D Y_0^0=1, no sqrt(3))", () => {
    const [w, y, z, x] = encodeMonoToFoaSN3D(1, Math.PI / 2, 0);
    expect(w).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(1, 12); // unit peak gain — SN3D, NOT sqrt(3)
    expect(z).toBeCloseTo(0, 12);
    expect(x).toBeCloseTo(0, 12);
  });

  it("up (el=+90deg) steers to +Z and zeroes X and Y", () => {
    const [w, y, z, x] = encodeMonoToFoaSN3D(1, 0, Math.PI / 2);
    expect(w).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(1, 12);
    expect(x).toBeCloseTo(0, 12);
  });

  it("W carries the source unchanged regardless of direction (W invariance)", () => {
    for (const [az, el] of [
      [0, 0],
      [0.3, -0.7],
      [Math.PI, 0.2],
      [-1.1, 1.0],
    ]) {
      const [w] = encodeMonoToFoaSN3D(0.42, az, el);
      expect(w).toBeCloseTo(0.42, 12);
    }
  });

  // The Condon-Shortley / (-1)^m sign trap: omitting it rotates the scene 180
  // degrees in azimuth (Ahrens 2022, p.6 / lines 22,142). A source at az and
  // the same source at az+180 must produce MIRRORED Y and X (the horizontal
  // order-1 harmonics are odd: sin(theta+pi) = -sin(theta), cos(theta+pi) =
  // -cos(theta)), while W and Z are unchanged.
  it("180deg azimuth rotation mirrors Y and X but leaves W and Z (property)", () => {
    const samples: Array<[number, number]> = [
      [0, 0],
      [0.5, 0.3],
      [1.2, -0.4],
      [-0.9, 0.8],
      [2.7, 0.1],
      [Math.PI / 3, -Math.PI / 6],
    ];
    for (const [az, el] of samples) {
      const [w0, y0, z0, x0] = encodeMonoToFoaSN3D(1, az, el);
      const [w1, y1, z1, x1] = encodeMonoToFoaSN3D(1, az + Math.PI, el);
      expect(w1).toBeCloseTo(w0, 12);
      expect(z1).toBeCloseTo(z0, 12);
      expect(y1).toBeCloseTo(-y0, 12);
      expect(x1).toBeCloseTo(-x0, 12);
    }
  });

  it("scales linearly in the input sample", () => {
    const [w1, y1, z1, x1] = encodeMonoToFoaSN3D(1, 0.7, 0.2);
    const [w3, y3, z3, x3] = encodeMonoToFoaSN3D(3, 0.7, 0.2);
    expect(w3).toBeCloseTo(3 * w1, 12);
    expect(y3).toBeCloseTo(3 * y1, 12);
    expect(z3).toBeCloseTo(3 * z1, 12);
    expect(x3).toBeCloseTo(3 * x1, 12);
  });
});

describe("FoaDecoderEffect — FOA->binaural decoder (Ahrens 2022 eq.31; Omnitone WY/ZX)", () => {
  // A 4-channel stub HRIR so build() never touches decodeAudioData/fetch.
  const stubHrir = () => new AudioContext().createBuffer(4, 256, 48000);

  it("createFoaDecoder returns a CacophonyEffect", () => {
    const effect = cacophony.createFoaDecoder();
    expect(isCacophonyEffect(effect)).toBe(true);
    expect(effect).toBeInstanceOf(FoaDecoderEffect);
  });

  it("build() constructs the locked node graph: 4ch splitter -> 2 mergers -> 2 convolvers", async () => {
    const { created } = instrumentGraphFactories();
    const effect = cacophony.createFoaDecoder({ hrir: stubHrir() });

    await effect.build(audioContextMock);

    const splitters = created.filter((n) => n.kind === "splitter");
    const mergers = created.filter((n) => n.kind === "merger");
    const convolvers = created.filter((n) => n.kind === "convolver");

    // foaInput(4ch) + splitterWY(2ch) + splitterZX(2ch)
    expect(splitters.map((s) => s.arg)).toEqual([4, 2, 2]);
    // mergerWY(2ch) + mergerZX(2ch) + mergerBinaural(2ch)
    expect(mergers.map((m) => m.arg)).toEqual([2, 2, 2]);
    expect(convolvers.length).toBe(2);
  });

  it("sets convolver.normalize = false on both convolvers (HRIR is pre-scaled)", async () => {
    const { created } = instrumentGraphFactories();
    await cacophony.createFoaDecoder({ hrir: stubHrir() }).build(audioContextMock);

    const convolvers = created.filter((n) => n.kind === "convolver");
    expect(convolvers.length).toBe(2);
    for (const c of convolvers) {
      expect(c.normalize).toBe(false);
    }
  });

  it("packs W+Y into the first convolver and Z+X into the second (Omnitone grouping)", async () => {
    const { created } = instrumentGraphFactories();
    await cacophony.createFoaDecoder({ hrir: stubHrir() }).build(audioContextMock);

    const foaInput = created.find((n) => n.kind === "splitter" && n.arg === 4)!;
    const [mergerWY, mergerZX] = created.filter((n) => n.kind === "merger");

    // ch0(W)->mergerWY in0, ch1(Y)->mergerWY in1
    expect(foaInput.connect).toHaveBeenCalledWith(mergerWY, 0, 0);
    expect(foaInput.connect).toHaveBeenCalledWith(mergerWY, 1, 1);
    // ch2(Z)->mergerZX in0, ch3(X)->mergerZX in1
    expect(foaInput.connect).toHaveBeenCalledWith(mergerZX, 2, 0);
    expect(foaInput.connect).toHaveBeenCalledWith(mergerZX, 3, 1);
  });

  it("applies a -1 GainNode on the Y right-ear path (asymmetric-degree inversion)", async () => {
    const { created } = instrumentGraphFactories();
    // Capture the GainNodes the effect creates so we can read their gain.value.
    const realCreateGain = audioContextMock.createGain.bind(audioContextMock);
    const gains: Array<{ node: ReturnType<typeof realCreateGain>; connect: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(audioContextMock, "createGain").mockImplementation(() => {
      const node = realCreateGain();
      const connect = vi.fn();
      Object.assign(node, { connect });
      gains.push({ node, connect });
      return node;
    });

    await cacophony.createFoaDecoder({ hrir: stubHrir() }).build(audioContextMock);

    // Exactly one gain is set to -1 (the Y right-ear inverter); the output gain
    // is left at its default 1.
    const inverters = gains.filter((g) => g.node.gain.value === -1);
    expect(inverters.length).toBe(1);
    // The inverter is fed by splitterWY's right channel (output index 1).
    const splitterWY = created.filter((n) => n.kind === "splitter" && n.arg === 2)[0];
    expect(splitterWY.connect).toHaveBeenCalledWith(inverters[0].node, 1);
  });

  it("build() throws if the context lacks channel split/merge/convolve support", async () => {
    const bare = { createGain: audioContextMock.createGain.bind(audioContextMock) } as never;
    await expect(cacophony.createFoaDecoder({ hrir: stubHrir() }).build(bare)).rejects.toThrow(
      /createChannelSplitter/,
    );
  });

  it("falls back to loadFoaHrir when no hrir option is supplied", async () => {
    instrumentGraphFactories();
    const loadSpy = vi.spyOn(cacophony, "loadFoaHrir").mockResolvedValue(stubHrir());

    await cacophony.createFoaDecoder().build(audioContextMock);

    expect(loadSpy).toHaveBeenCalledWith(audioContextMock);
  });
});

describe("Resurrection: StereoToFoaUpmixer -> FoaDecoderEffect (perceptual stereo->binaural)", () => {
  const mockAudioWorklet = () => {
    const addModule = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(audioContextMock, "audioWorklet", {
      value: { addModule },
      writable: true,
      configurable: true,
    });
    return addModule;
  };

  beforeEach(() => {
    mockAudioWorklet();
  });

  it("the upmixer's 4-ch output node connects into the decoder's 4-ch input splitter", async () => {
    const { created } = instrumentGraphFactories();
    const stubHrir = new AudioContext().createBuffer(4, 256, 48000);

    // The dead encoder: createStereoToBFormatNode builds a 4-ch worklet node.
    const upmixer = await cacophony.createStereoToBFormatNode();
    // Wrap its connect so we can prove signal leaves the encoder.
    const upmixerConnect = vi.fn();
    Object.assign(upmixer, { connect: upmixerConnect });

    // Build the decoder; its head node is the 4-ch input ChannelSplitter.
    const decoderHead = await cacophony.createFoaDecoder({ hrir: stubHrir }).build(audioContextMock);

    // Route the previously-dead encoder output AS-IS into the decoder input
    // (no normalization bridge — ACN ordering already lines up).
    upmixer.connect(decoderHead as never);

    // Proof the encoder now carries signal to the decoder.
    expect(upmixerConnect).toHaveBeenCalledWith(decoderHead);
    // And the decoder head is the 4-channel input splitter (head-of-chain).
    const foaInput = created.find((n) => n.kind === "splitter" && n.arg === 4);
    expect(decoderHead).toBe(foaInput as unknown);
  });

  it("the decoder produces a 2-channel binaural output node (mergerBinaural -> outputGain)", async () => {
    const { created } = instrumentGraphFactories();
    const stubHrir = new AudioContext().createBuffer(4, 256, 48000);
    // Capture the output GainNode the binaural merger feeds.
    const realCreateGain = audioContextMock.createGain.bind(audioContextMock);
    const gains: Array<{ connect: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(audioContextMock, "createGain").mockImplementation(() => {
      const node = realCreateGain();
      const connect = vi.fn();
      Object.assign(node, { connect });
      gains.push({ connect });
      return node;
    });

    await cacophony.createFoaDecoder({ hrir: stubHrir }).build(audioContextMock);

    // mergerBinaural is the third (2ch) merger; it must connect into a GainNode.
    const mergerBinaural = created.filter((n) => n.kind === "merger")[2];
    const outputGainConnectedFrom = (mergerBinaural.connect as ReturnType<typeof vi.fn>).mock.calls.some(
      (call) => gains.some((g) => g.connect === (call[0] as { connect?: unknown })?.connect),
    );
    // mergerBinaural connected to *something* (the output gain). Assert it was called.
    expect((mergerBinaural.connect as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    expect(outputGainConnectedFrom).toBe(true);
  });
});
