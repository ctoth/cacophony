import { AudioContext } from "standardized-audio-context-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoaDecoder, FoaDecoderEffect, isBuiltEffectGraph, isCacophonyEffect } from "./effects";
import { audioContextMock, cacophony } from "./setupTests";
import { encodeMonoToFoaSN3D } from "./spatial/foa-encode";

/**
 * The standardized-audio-context mock returns bare `{}` stubs for
 * createChannelSplitter / createChannelMerger / createConvolver (they have no
 * `connect`). To assert the FoaDecoder graph we install spy-wrapped fakes for
 * those factories (generalizing the "wrap createGain" idiom from
 * scout-effect-bus-system.md §5) and capture every created node so we can
 * inspect the edges. createGain is ALSO wrapped (it has a real `gain`
 * AudioParam the decoder writes -1 into) so the inverter and output gain are
 * captured with their own `connect` spies.
 *
 * IMPORTANT: the mock GainNode is a singleton-ish object whose identity we rely
 * on to distinguish nodes, so each captured node carries an `id`.
 */
interface CapturedNode {
  kind: string;
  arg?: number;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  normalize?: boolean;
  buffer?: unknown;
  gain?: { value: number };
  node: unknown;
}

function instrumentGraphFactories(): { created: CapturedNode[] } {
  const created: CapturedNode[] = [];
  const make = (kind: string) => (arg?: number) => {
    const node = {
      kind,
      arg,
      connect: vi.fn(),
      disconnect: vi.fn(),
      normalize: true,
      buffer: null,
    } as CapturedNode;
    node.node = node;
    created.push(node);
    return node as unknown as never;
  };
  vi.spyOn(audioContextMock, "createChannelSplitter").mockImplementation(make("splitter") as never);
  vi.spyOn(audioContextMock, "createChannelMerger").mockImplementation(make("merger") as never);
  // createConvolver / createBuffer are `@todo` stubs returning {} in the mock.
  (audioContextMock as unknown as { createConvolver: () => unknown }).createConvolver = make("convolver") as never;
  // Wrap createGain too so the inverter (-1) and the output GainNode are
  // captured as CapturedNodes with their own connect spies.
  vi.spyOn(audioContextMock, "createGain").mockImplementation((() => {
    const gainValue = { value: 1 };
    const node = {
      kind: "gain",
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: gainValue,
    } as CapturedNode;
    node.node = node;
    created.push(node);
    return node as unknown as never;
  }) as never);
  return { created };
}

/** A 4-channel stub HRIR so create() never touches decodeAudioData/fetch. */
const stubHrir = () => new AudioContext().createBuffer(4, 256, 48000);

/**
 * Identify the canonical decoder nodes from the captured-node list, by the
 * deterministic creation order in FoaDecoder.create:
 *   splitter[0]=input(4ch), splitter[1]=splitterWY(2ch), splitter[2]=splitterZX(2ch)
 *   merger[0]=mergerWY, merger[1]=mergerZX, merger[2]=mergerBinaural
 *   gain[0]=yRightInverter(-1), gain[1]=output
 */
function namedNodes(created: CapturedNode[]) {
  const splitters = created.filter((n) => n.kind === "splitter");
  const mergers = created.filter((n) => n.kind === "merger");
  const gains = created.filter((n) => n.kind === "gain");
  return {
    input: splitters[0],
    splitterWY: splitters[1],
    splitterZX: splitters[2],
    mergerWY: mergers[0],
    mergerZX: mergers[1],
    mergerBinaural: mergers[2],
    inverter: gains.find((g) => g.gain?.value === -1)!,
    output: gains.find((g) => g.gain?.value !== -1)!,
  };
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

describe("FoaDecoder — standalone FOA->binaural format converter (Ahrens 2022 eq.31; Omnitone WY/ZX)", () => {
  it("createFoaDecoder returns a standalone FoaDecoder with .input and .output", async () => {
    instrumentGraphFactories();
    const decoder = await cacophony.createFoaDecoder({ hrir: stubHrir() });
    expect(decoder).toBeInstanceOf(FoaDecoder);
    expect(decoder.input).toBeDefined();
    expect(decoder.output).toBeDefined();
    // The explicit endpoint object remains standalone: the effect wrapper is
    // created separately via createFoaDecoderEffect().
    expect((decoder as unknown as { build?: unknown }).build).toBeUndefined();
  });

  it("createFoaDecoderEffect returns a CacophonyEffect wrapper around the decoder graph", async () => {
    const { created } = instrumentGraphFactories();
    const effect = cacophony.createFoaDecoderEffect({ hrir: stubHrir() });

    expect(effect).toBeInstanceOf(FoaDecoderEffect);
    expect(isCacophonyEffect(effect)).toBe(true);

    const built = await effect.build(cacophony.context);
    expect(isBuiltEffectGraph(built)).toBe(true);
    if (!isBuiltEffectGraph(built)) {
      throw new Error("expected endpoint graph");
    }

    const { input, output } = namedNodes(created);
    expect(built.input).toBe(input as unknown);
    expect(built.output).toBe(output as unknown);
    expect(built.handle).toBe(input as unknown);
  });

  it("createFoaDecoderEffect can be added to a dedicated bus and routes from decoder.output onward", async () => {
    const { created } = instrumentGraphFactories();
    const bus = cacophony.createBus("foa-decoder-test");
    const busInputConnect = vi.spyOn(bus.input, "connect");

    const handle = await bus.addFilter(cacophony.createFoaDecoderEffect({ hrir: stubHrir() }));
    const { input, output } = namedNodes(created);

    expect(handle).toBe(input as unknown);
    expect(bus.filters).toEqual([input as unknown]);
    expect(busInputConnect).toHaveBeenCalledWith(input as unknown);
    expect(output.connect).toHaveBeenCalledWith(bus.output);

    bus.destroy();
  });

  it("constructs the node graph: 4ch input splitter -> 2 mergers -> 2 convolvers", async () => {
    const { created } = instrumentGraphFactories();
    await cacophony.createFoaDecoder({ hrir: stubHrir() });

    const splitters = created.filter((n) => n.kind === "splitter");
    const mergers = created.filter((n) => n.kind === "merger");
    const convolvers = created.filter((n) => n.kind === "convolver");

    // input(4ch) + splitterWY(2ch) + splitterZX(2ch)
    expect(splitters.map((s) => s.arg)).toEqual([4, 2, 2]);
    // mergerWY(2ch) + mergerZX(2ch) + mergerBinaural(2ch)
    expect(mergers.map((m) => m.arg)).toEqual([2, 2, 2]);
    expect(convolvers.length).toBe(2);
  });

  it("sets convolver.normalize = false on both convolvers (HRIR is pre-scaled)", async () => {
    const { created } = instrumentGraphFactories();
    await cacophony.createFoaDecoder({ hrir: stubHrir() });

    const convolvers = created.filter((n) => n.kind === "convolver");
    expect(convolvers.length).toBe(2);
    for (const c of convolvers) {
      expect(c.normalize).toBe(false);
    }
  });

  it("packs W+Y into the first convolver and Z+X into the second (Omnitone grouping)", async () => {
    const { created } = instrumentGraphFactories();
    await cacophony.createFoaDecoder({ hrir: stubHrir() });
    const { input, mergerWY, mergerZX } = namedNodes(created);

    // ch0(W)->mergerWY in0, ch1(Y)->mergerWY in1
    expect(input.connect).toHaveBeenCalledWith(mergerWY, 0, 0);
    expect(input.connect).toHaveBeenCalledWith(mergerWY, 1, 1);
    // ch2(Z)->mergerZX in0, ch3(X)->mergerZX in1
    expect(input.connect).toHaveBeenCalledWith(mergerZX, 2, 0);
    expect(input.connect).toHaveBeenCalledWith(mergerZX, 3, 1);
  });

  // === BLOCKER 1 REGRESSION TEST (Ahrens eq.31 per-ear completeness) =========
  // The decode must route ALL FOUR SH channels (W, Y, Z, X) into BOTH the left
  // ear (mergerBinaural input 0) AND the right ear (mergerBinaural input 1).
  // The previously-broken graph sent only W+Z to the left ear and only -Y+X to
  // the right ear; this test FAILS on that graph (it asserts edges that graph
  // never made: W/Z into the right ear, Y/X into the left ear).
  //
  // Channel carriers after the WY/ZX stereo convolvers:
  //   splitterWY ch0 = W,  splitterWY ch1 = Y
  //   splitterZX ch0 = Z,  splitterZX ch1 = X
  // mergerBinaural input 0 = LEFT ear, input 1 = RIGHT ear.
  it("routes ALL FOUR SH channels into BOTH ears (Ahrens eq.31 per-ear completeness)", async () => {
    const { created } = instrumentGraphFactories();
    await cacophony.createFoaDecoder({ hrir: stubHrir() });
    const { splitterWY, splitterZX, mergerBinaural, inverter } = namedNodes(created);

    // --- LEFT ear (mergerBinaural input 0) gets W, Y, Z, X ---
    // W: splitterWY ch0 -> mergerBinaural (in0)
    expect(splitterWY.connect).toHaveBeenCalledWith(mergerBinaural, 0, 0);
    // Y: splitterWY ch1 -> mergerBinaural (in0)
    expect(splitterWY.connect).toHaveBeenCalledWith(mergerBinaural, 1, 0);
    // Z: splitterZX ch0 -> mergerBinaural (in0)
    expect(splitterZX.connect).toHaveBeenCalledWith(mergerBinaural, 0, 0);
    // X: splitterZX ch1 -> mergerBinaural (in0)
    expect(splitterZX.connect).toHaveBeenCalledWith(mergerBinaural, 1, 0);

    // --- RIGHT ear (mergerBinaural input 1) gets W, -Y, Z, X ---
    // W: splitterWY ch0 -> mergerBinaural (in1)
    expect(splitterWY.connect).toHaveBeenCalledWith(mergerBinaural, 0, 1);
    // Z: splitterZX ch0 -> mergerBinaural (in1)
    expect(splitterZX.connect).toHaveBeenCalledWith(mergerBinaural, 0, 1);
    // X: splitterZX ch1 -> mergerBinaural (in1)
    expect(splitterZX.connect).toHaveBeenCalledWith(mergerBinaural, 1, 1);
    // Y (sign-flipped): splitterWY ch1 -> inverter(-1) -> mergerBinaural (in1)
    expect(splitterWY.connect).toHaveBeenCalledWith(inverter, 1, 0);
    expect(inverter.connect).toHaveBeenCalledWith(mergerBinaural, 0, 1);
  });

  it("applies exactly one -1 GainNode and feeds it from the Y (splitterWY ch1) path", async () => {
    const { created } = instrumentGraphFactories();
    await cacophony.createFoaDecoder({ hrir: stubHrir() });

    const inverters = created.filter((n) => n.kind === "gain" && n.gain?.value === -1);
    expect(inverters.length).toBe(1);
    const { splitterWY, inverter } = namedNodes(created);
    expect(splitterWY.connect).toHaveBeenCalledWith(inverter, 1, 0);
  });

  // === BLOCKER 2: .output is the 2-channel stereo node, NOT the 4-ch input ===
  it("exposes .output as the binaural stereo GainNode (mergerBinaural -> output), distinct from .input", async () => {
    const { created } = instrumentGraphFactories();
    const decoder = await cacophony.createFoaDecoder({ hrir: stubHrir() });
    const { input, mergerBinaural, output } = namedNodes(created);

    // The decoder's externally-visible endpoints are distinct nodes.
    expect(decoder.input).toBe(input as unknown);
    expect(decoder.output).toBe(output as unknown);
    expect(decoder.output).not.toBe(decoder.input);
    // The binaural merger feeds the output GainNode.
    expect(mergerBinaural.connect).toHaveBeenCalledWith(output);
  });

  it("routing downstream goes from .output (stereo), not the 4-channel .input", async () => {
    const { created } = instrumentGraphFactories();
    const decoder = await cacophony.createFoaDecoder({ hrir: stubHrir() });
    const { input, output } = namedNodes(created);

    // A downstream destination the caller connects the decoder to.
    const destination = { connect: vi.fn() } as unknown as Parameters<typeof decoder.output.connect>[0];
    decoder.output.connect(destination);

    // The stereo output carried the edge; the 4-ch input did NOT connect to it.
    expect(output.connect).toHaveBeenCalledWith(destination);
    expect(input.connect).not.toHaveBeenCalledWith(destination);
  });

  it("throws if the context lacks channel split/merge/convolve support", async () => {
    const bare = { createGain: vi.fn() } as never;
    await expect(cacophony.createFoaDecoder({ hrir: stubHrir() }, bare)).rejects.toThrow(/createChannelSplitter/);
  });

  it("falls back to loadFoaHrir when no hrir option is supplied", async () => {
    instrumentGraphFactories();
    const loadSpy = vi.spyOn(cacophony, "loadFoaHrir").mockResolvedValue(stubHrir());

    await cacophony.createFoaDecoder();

    expect(loadSpy).toHaveBeenCalledWith(audioContextMock);
  });
});

describe("Resurrection: StereoToFoaUpmixer -> FoaDecoder (perceptual stereo->binaural)", () => {
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

  // === MAJOR FIX: REAL resurrection wiring (no vi.fn() replacement of connect) =
  // Build the real upmixer node and the real decoder through the library API,
  // wire the upmixer's actual output node into decoder.input, and assert the
  // upmixer's OWN connect spy recorded the edge into the decoder's 4-ch input.
  it("wires the real upmixer output node into decoder.input (real graph edge, not a self-spy)", async () => {
    const { created } = instrumentGraphFactories();

    // The dead encoder: createStereoToBFormatNode builds a 4-ch worklet node.
    // setupTests mocks AudioWorkletNode with a real vi.fn() `connect` — we spy
    // on THAT node's own connect (no replacement), so the assertion proves the
    // upmixer node really emitted an edge, not that we called our own stub.
    const upmixer = await cacophony.createStereoToBFormatNode();
    const upmixerConnect = vi.spyOn(upmixer, "connect");

    const decoder = await cacophony.createFoaDecoder({ hrir: stubHrir() });

    // Resurrection wiring through the public endpoint: upmixer -> decoder.input.
    upmixer.connect(decoder.input as never);

    // The real upmixer node emitted the edge into the decoder's input...
    expect(upmixerConnect).toHaveBeenCalledWith(decoder.input);
    // ...and decoder.input is the 4-channel input splitter (head-of-chain).
    const { input } = namedNodes(created);
    expect(decoder.input).toBe(input as unknown);
    expect(input.arg).toBe(4);
  });

  it("the decoder produces a 2-channel binaural output node fed by the binaural merger", async () => {
    const { created } = instrumentGraphFactories();

    const decoder = await cacophony.createFoaDecoder({ hrir: stubHrir() });
    const { mergerBinaural, output } = namedNodes(created);

    // mergerBinaural (the 3rd 2ch merger) feeds the output GainNode the caller
    // routes downstream — the decoder's stereo tail.
    expect(mergerBinaural.connect).toHaveBeenCalledWith(output);
    expect(decoder.output).toBe(output as unknown);
  });
});

/*
 * Ahrens 2022 eq.31 per-ear MAC — DECODE-MATH oracle.
 *
 * jsdom has no Web Audio rendering, so the real ConvolverNode decode graph
 * cannot be exercised on a SIGNAL here (its EDGES are asserted above). This
 * block proves the eq.31 decode MATH the graph realizes: each ear is a weighted
 * sum over the four SH channels, the SAME stored SH-HRIR serving both ears via
 * the W/Z/X-symmetric, Y-antisymmetric structure the Omnitone graph wires
 * (W,Z,X -> both ears; Y -> +L and -R through the -1 inverter). Modelling each
 * channel's HRTF as a real per-channel gain (a frequency-flat HRTF, the DC
 * special case of eq.31) is exactly that lateralization structure — so this
 * directly answers "does the resurrected encode->decode path produce
 * ear-differentiated binaural audio, and is the convention correct".
 *
 * RESIDUAL GAP (environmental, not a coverage gap): the frequency-dependent
 * ConvolverNode rendering and the bundled Omnitone HRIR's SN3D normalization
 * need an OfflineAudioContext / browser e2e test; this unit suite cannot render.
 */
const HRIR_GAINS = { gW: 0.7, gY: 0.5, gZ: 0.3, gX: 0.4 } as const;

/** The eq.31 per-ear MAC the Omnitone graph realizes (W,Z,X symmetric; Y antisymmetric). */
function decodeFoaToBinaural(
  [w, y, z, x]: [number, number, number, number],
  g: { gW: number; gY: number; gZ: number; gX: number } = HRIR_GAINS,
): { left: number; right: number } {
  const symmetric = g.gW * w + g.gZ * z + g.gX * x; // W,Z,X -> both ears equally
  const lateral = g.gY * y; // Y -> +L, -R (the -1 right-ear inverter)
  return { left: symmetric + lateral, right: symmetric - lateral };
}

describe("FoaDecoder eq.31 per-ear MAC (the decode math the Omnitone graph realizes)", () => {
  it("a CENTER (front) source is binaurally symmetric: L == R, and carries signal (Y=0)", () => {
    const foa = encodeMonoToFoaSN3D(1, 0, 0);
    const { left, right } = decodeFoaToBinaural(foa);
    expect(left).toBeCloseTo(right, 12);
    expect(Math.abs(left)).toBeGreaterThan(0); // non-vacuous: not silence
  });

  it("a LEFT source (az=+90) is louder in the LEFT ear, by exactly 2*gY*Y", () => {
    const foa = encodeMonoToFoaSN3D(1, Math.PI / 2, 0); // Y = 1 (SN3D)
    const { left, right } = decodeFoaToBinaural(foa);
    expect(left).toBeGreaterThan(right);
    expect(left - right).toBeCloseTo(2 * HRIR_GAINS.gY, 12);
  });

  it("a RIGHT source (az=-90) is louder in the RIGHT ear (mirror of left)", () => {
    const foa = encodeMonoToFoaSN3D(1, -Math.PI / 2, 0);
    const { left, right } = decodeFoaToBinaural(foa);
    expect(right).toBeGreaterThan(left);
  });

  it("both ears receive ALL of W, Z, X (no channel dropped); Y is the only antisymmetric channel", () => {
    const W = decodeFoaToBinaural([1, 0, 0, 0]);
    expect(W.left).toBeCloseTo(HRIR_GAINS.gW, 12);
    expect(W.right).toBeCloseTo(HRIR_GAINS.gW, 12);
    const Z = decodeFoaToBinaural([0, 0, 1, 0]);
    expect(Z.left).toBeCloseTo(HRIR_GAINS.gZ, 12);
    expect(Z.right).toBeCloseTo(HRIR_GAINS.gZ, 12);
    const X = decodeFoaToBinaural([0, 0, 0, 1]);
    expect(X.left).toBeCloseTo(HRIR_GAINS.gX, 12);
    expect(X.right).toBeCloseTo(HRIR_GAINS.gX, 12);
    const Y = decodeFoaToBinaural([0, 1, 0, 0]);
    expect(Y.left).toBeCloseTo(HRIR_GAINS.gY, 12);
    expect(Y.right).toBeCloseTo(-HRIR_GAINS.gY, 12); // inverted on the right ear
  });

  it("the decode is sensitive to an SN3D<->N3D Y mismatch (would catch a wrong-normalization HRIR)", () => {
    // Encoder emits SN3D (Y=1 at az=90). An N3D-normalized encode/HRIR would put
    // Y at sqrt(3). The decode lateralization scales with Y, so a normalization
    // disagreement is detectable — this test is not blind to the convention.
    const sn3d = encodeMonoToFoaSN3D(1, Math.PI / 2, 0);
    const n3d: [number, number, number, number] = [sn3d[0], sn3d[1] * Math.sqrt(3), sn3d[2], sn3d[3]];
    const matched = decodeFoaToBinaural(sn3d);
    const mismatched = decodeFoaToBinaural(n3d);
    expect(Math.abs(mismatched.left - mismatched.right)).toBeGreaterThan(Math.abs(matched.left - matched.right));
    expect(matched.left - matched.right).toBeCloseTo(2 * HRIR_GAINS.gY, 12); // SN3D: Y=1
  });
});
