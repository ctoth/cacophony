/**
 * Cacophony Effects: a thin abstraction over Web Audio nodes that lets a Bus
 * carry rich, possibly worklet-backed processing in its filter chain.
 *
 * A {@link CacophonyEffect} is responsible for producing a live AudioNode
 * subgraph when its `build` method is invoked. The returned node is the
 * "head" of the subgraph (the input the chain will connect into); the effect
 * implementation is responsible for wiring any internal structure and
 * arranging that the same node also serves as the output (or that the head
 * is the only externally-visible node).
 *
 * The `build` return is `Promise<AudioNode> | AudioNode` so worklet-backed
 * effects (e.g. DattorroReverb) can `await` their AudioWorklet module load
 * before constructing the node, while pure-DOM effects (BiquadFilter, simple
 * GainNode wrappers) can return synchronously.
 */

import type { AudioBuffer, AudioNode, AudioWorkletNode, BaseContext, BiquadFilterNode } from "./context";

/**
 * Minimal structural interface for the Cacophony surface ReverbEffect needs.
 * Declared locally so this module avoids a circular import on cacophony.ts.
 *
 * Both methods accept an optional `BaseContext` so the effect can build on a
 * context different from the host Cacophony instance's own — required for the
 * cross-context contract `CacophonyEffect.build(context)` promises.
 */
interface ReverbHost {
  loadDattorroReverb(signal?: AbortSignal, context?: BaseContext): Promise<void>;
  createDattorroReverbNode(options: AudioWorkletNodeOptions, context?: BaseContext): Promise<AudioWorkletNode>;
}

/**
 * Minimal structural interface for the Cacophony surface DynamicsEffect needs.
 * Declared locally (like {@link ReverbHost}) so this module avoids a circular
 * import on cacophony.ts. Both methods accept an optional `BaseContext` for the
 * cross-context contract `CacophonyEffect.build(context)` promises.
 */
interface DynamicsHost {
  loadDynamics(signal?: AbortSignal, context?: BaseContext): Promise<void>;
  createDynamicsNode(options: AudioWorkletNodeOptions, context?: BaseContext): Promise<AudioWorkletNode>;
}

/**
 * Minimal structural interface for the Cacophony surface FdnReverbEffect needs.
 * Declared locally (like {@link ReverbHost}) so this module avoids a circular
 * import on cacophony.ts. Both methods accept an optional `BaseContext` for the
 * cross-context contract `CacophonyEffect.build(context)` promises.
 */
interface FdnReverbHost {
  loadFdnReverb(signal?: AbortSignal, context?: BaseContext): Promise<void>;
  createFdnReverbNode(options: AudioWorkletNodeOptions, context?: BaseContext): Promise<AudioWorkletNode>;
}

/**
 * Minimal structural interface for the Cacophony surface WaveshaperEffect needs.
 * Declared locally (like {@link ReverbHost}) so this module avoids a circular
 * import on cacophony.ts. Both methods accept an optional `BaseContext` for the
 * cross-context contract `CacophonyEffect.build(context)` promises.
 */
interface WaveshaperHost {
  loadWaveshaper(signal?: AbortSignal, context?: BaseContext): Promise<void>;
  createWaveshaperNode(options: AudioWorkletNodeOptions, context?: BaseContext): Promise<AudioWorkletNode>;
}

/**
 * Minimal structural interface for the Cacophony surface {@link FoaDecoder} needs.
 * Declared locally (like {@link ReverbHost}) so this module avoids a circular
 * import on cacophony.ts. `loadFoaHrir` resolves (and per-context memoizes) the
 * bundled order-1 SH-HRIR `AudioBuffer`; the decoder slices it into the two
 * stereo ConvolverNode buffers.
 */
interface FoaDecoderHost {
  loadFoaHrir(context?: BaseContext): Promise<AudioBuffer>;
  /** The host's own default audio context, used when no context is supplied. */
  defaultContext(): BaseContext;
}

/**
 * Public surface every Cacophony effect implements. `build` is called by
 * `Bus.addFilter` to materialize the effect's live node graph against a
 * specific audio context. An effect may be built more than once (e.g. on
 * multiple buses or contexts), or it may bind to a single shared node — the
 * implementation is free to choose. Cacophony itself does not cache.
 */
export interface CacophonyEffect {
  build(context: BaseContext): Promise<AudioNode> | AudioNode;
}

/**
 * Tracks AudioNodes that were produced by Cacophony's own factories so the
 * Bus filter-chain admission policy can distinguish a Cacophony-built node
 * (admit directly) from a raw third-party node (reject — user must wrap via
 * `cacophony.shareEffect`). WeakSet membership is GC-safe and identity-keyed.
 */
const cacophonyBuiltBiquads = new WeakSet<BiquadFilterNode>();

/**
 * Mark a BiquadFilterNode as Cacophony-built. Called by
 * {@link Cacophony.createBiquadFilter} on the freshly constructed node.
 */
export function markAsCacophonyBiquad(node: BiquadFilterNode): void {
  cacophonyBuiltBiquads.add(node);
}

/**
 * Test whether a node was produced by {@link Cacophony.createBiquadFilter}.
 * Used by {@link Bus.addFilter} to admit Biquads directly without wrapping.
 */
export function isCacophonyBuiltBiquad(node: unknown): node is BiquadFilterNode {
  return typeof node === "object" && node !== null && cacophonyBuiltBiquads.has(node as BiquadFilterNode);
}

/**
 * Effect wrapper for a pre-constructed BiquadFilterNode. `build` returns
 * the same node every time, so the same Biquad is shared across every bus
 * that adds this effect. Use when you want explicit shared filter state
 * across multiple buses.
 */
export class BiquadEffect implements CacophonyEffect {
  constructor(private readonly node: BiquadFilterNode) {}

  build(_context: BaseContext): AudioNode {
    return this.node;
  }
}

/**
 * Explicit "I know what I'm doing" wrapper around a raw AudioNode the user
 * built outside of Cacophony's factories. `Bus.addFilter` rejects raw
 * AudioNodes by default to surface the shared-state implication; wrapping
 * the node in a `ShareEffect` (via `cacophony.shareEffect(node)`) is the
 * documented opt-in. The same node instance is returned from every `build`
 * call, so all buses using the effect feed the same Web Audio node.
 */
export class ShareEffect implements CacophonyEffect {
  constructor(private readonly node: AudioNode) {}

  build(_context: BaseContext): AudioNode {
    return this.node;
  }
}

/**
 * Subset of the {@link import('./processors/dattorro-reverb').DattorroReverbProcessor}
 * AudioWorkletProcessor's AudioParam set that we expose for construction-time
 * configuration via {@link Cacophony.createReverb}. All values are optional
 * and clamped to the worklet's documented ranges (0..1 for most params).
 *
 * Every field corresponds to a `parameterData` entry passed to the
 * AudioWorkletNode constructor; the worklet handles validation downstream.
 */
export interface ReverbOptions {
  /** Pre-delay in samples (0..sampleRate-1). Default 0. */
  preDelay?: number;
  /** Input bandwidth (0..1). Default 0.9999. */
  bandwidth?: number;
  /** First input diffusion stage (0..1). Default 0.75. */
  inputDiffusion1?: number;
  /** Second input diffusion stage (0..1). Default 0.625. */
  inputDiffusion2?: number;
  /** Tail decay (0..1). Default 0.5. */
  decay?: number;
  /** First decay diffusion stage (0..0.999999). Default 0.7. */
  decayDiffusion1?: number;
  /** Second decay diffusion stage (0..0.999999). Default 0.5. */
  decayDiffusion2?: number;
  /** Frequency damping (0..1). Default 0.005. */
  damping?: number;
  /** Modulation rate (0..2). Default 0.5. */
  excursionRate?: number;
  /** Modulation depth (0..2). Default 0.7. */
  excursionDepth?: number;
  /** Wet mix (0..1). Default 0.3. */
  wet?: number;
  /** Dry mix (0..1). Default 0.6. */
  dry?: number;
}

/**
 * CacophonyEffect that builds a DattorroReverb AudioWorkletNode. Calls
 * `cacophony.loadDattorroReverb(undefined, context)` first to idempotently
 * ensure the worklet module is registered on the supplied context, then
 * constructs the worklet node on the same context with the supplied options
 * as `parameterData`. The returned node is the head AND tail of the
 * subgraph (single-node wet/dry handled internally by the processor).
 *
 * Cross-context support: `build(context)` honors the {@link CacophonyEffect}
 * contract — when the effect is added to a Bus whose context differs from
 * the creating Cacophony's own context, the worklet is loaded and the
 * AudioWorkletNode is constructed against the bus's context, not the host's.
 */
export class ReverbEffect implements CacophonyEffect {
  constructor(
    private readonly host: ReverbHost,
    private readonly options: ReverbOptions = {},
  ) {}

  async build(context: BaseContext): Promise<AudioWorkletNode> {
    await this.host.loadDattorroReverb(undefined, context);
    return this.host.createDattorroReverbNode({ parameterData: this.options as Record<string, number> }, context);
  }
}

/**
 * Construction-time configuration for a {@link DynamicsEffect}, mirroring the
 * `dynamics` AudioWorkletProcessor's AudioParam set (see
 * {@link import('./processors/dynamics').DynamicsWorkletProcessor}). All fields
 * are optional; the worklet clamps to its documented ranges downstream.
 *
 * A single parameter set drives compressor, limiter, expander and gate
 * (Giannoulis 2012): ratio > 1 compresses, a very large ratio limits, and
 * ratio < 1 is downward expansion (an extreme low ratio is a gate). The
 * `createLimiter` / `createGate` factories are presets over these same params.
 */
export interface DynamicsOptions {
  /** Threshold T (dB), level above which compression starts. Default -24. Range -100..0. */
  threshold?: number;
  /** Ratio R (reciprocal of slope above T). Default 4. >1 compress, large=limit, <1 expand. Range 0.05..1000. */
  ratio?: number;
  /** Knee width W (dB), soft-knee transition centered on T (0 = hard). Default 6. Range 0..40. */
  knee?: number;
  /** Attack time tau_A (s). Default 0.003. Range 0..1. */
  attack?: number;
  /** Release time tau_R (s). Default 0.25. Range 0..5. */
  release?: number;
  /** Make-up gain M (dB), constant output boost. Default 0. Range -24..24. */
  makeup?: number;
}

/**
 * CacophonyEffect that builds a `dynamics` AudioWorkletNode — a feed-forward
 * dynamics processor (compressor/limiter/expander/gate) implementing Giannoulis,
 * Massberg & Reiss 2012. Mirrors {@link ReverbEffect}: `build` idempotently
 * loads the worklet module on the supplied context, then constructs the node
 * with the supplied {@link DynamicsOptions} as `parameterData`. Honors the
 * cross-context contract (builds against the bus's context, not the host's own).
 */
export class DynamicsEffect implements CacophonyEffect {
  constructor(
    private readonly host: DynamicsHost,
    private readonly options: DynamicsOptions = {},
  ) {}

  async build(context: BaseContext): Promise<AudioWorkletNode> {
    await this.host.loadDynamics(undefined, context);
    return this.host.createDynamicsNode({ parameterData: this.options as Record<string, number> }, context);
  }
}

/**
 * Construction-time configuration for an {@link FdnReverbEffect}, mirroring the
 * `fdn-reverb` AudioWorkletProcessor's AudioParam set (see
 * {@link import('./processors/fdn-reverb').FdnReverbWorkletProcessor}). All
 * fields are optional; the worklet clamps to its documented ranges downstream.
 *
 * The reverb is a Feedback Delay Network: a lossless paraunitary Hadamard
 * feedback core keeps it stable (Schlecht & Habets 2019), per-line absorption
 * filters set the decay (Jot & Chaigne 1991), and a sparse velvet-noise FIR
 * adds early echo density at no multiply cost (Fagerström et al. 2020).
 */
export interface FdnReverbOptions {
  /** Reverberation time T60 in seconds (−60 dB decay). Default 1.5. Range 0.001..20. */
  decayTime?: number;
  /** Pre-delay before the wet path in seconds. Default 0. Range 0..1. */
  preDelay?: number;
  /** High-frequency damping (0..1); higher shortens the HF tail. Default 0.3. */
  damping?: number;
  /** Velvet-noise diffusion amount (0..1); 0 bypasses. Default 0.5. */
  diffusion?: number;
  /** Wet/dry mix (0..1); 0 = dry, 1 = wet. Default 0.3. */
  mix?: number;
}

/**
 * CacophonyEffect that builds an `fdn-reverb` AudioWorkletNode — a Feedback
 * Delay Network reverberator (lossless paraunitary Hadamard feedback, Schlecht
 * & Habets 2019; Jot 1991 absorption-filter decay; Fagerström 2020 velvet-noise
 * diffusion). Mirrors {@link ReverbEffect}: `build` idempotently loads the
 * worklet module on the supplied context, then constructs the node with the
 * supplied {@link FdnReverbOptions} as `parameterData`. Honors the
 * cross-context contract (builds against the bus's context, not the host's own).
 */
export class FdnReverbEffect implements CacophonyEffect {
  constructor(
    private readonly host: FdnReverbHost,
    private readonly options: FdnReverbOptions = {},
  ) {}

  async build(context: BaseContext): Promise<AudioWorkletNode> {
    await this.host.loadFdnReverb(undefined, context);
    return this.host.createFdnReverbNode({ parameterData: this.options as Record<string, number> }, context);
  }
}

/**
 * Construction-time configuration for a {@link WaveshaperEffect}, mirroring the
 * `waveshaper` AudioWorkletProcessor's AudioParam set (see
 * {@link import('./processors/waveshaper').WaveshaperWorkletProcessor}). All
 * fields are optional; the worklet clamps to its documented ranges downstream.
 *
 * The effect is an antialiased distortion/waveshaper using first-order
 * Antiderivative Antialiasing (Parker, Zavalishin & Le Bivic 2016, DAFx-16):
 * y[n] = (F0(x_n) - F0(x_{n-1})) / (x_n - x_{n-1}) (eq.9), with an f(midpoint)
 * fallback at the 0/0 singularity (eq.10). It carries an inherent 0.5-sample
 * group delay (first-order ADAA, eq.17).
 */
export interface WaveshaperOptions {
  /** Pre-gain (drive) into the nonlinearity. Default 1. Range 0..100; >1 = harder saturation. */
  drive?: number;
  /** Nonlinearity index: 0 = hard clip (polynomial F0, eq.25), 1 = tanh soft clip (F0 = log cosh, eq.20). Default 0. */
  shape?: number;
  /** Wet/dry mix (0..1); 0 = dry bypass, 1 = fully shaped. Default 1. */
  mix?: number;
  /** Post-nonlinearity output gain (linear). Default 1. Range 0..4. */
  output?: number;
}

/**
 * CacophonyEffect that builds a `waveshaper` AudioWorkletNode — an antialiased
 * distortion/waveshaper implementing first-order Antiderivative Antialiasing
 * (Parker, Zavalishin & Le Bivic 2016, DAFx-16). Mirrors {@link ReverbEffect}:
 * `build` idempotently loads the worklet module on the supplied context, then
 * constructs the node with the supplied {@link WaveshaperOptions} as
 * `parameterData`. Honors the cross-context contract (builds against the bus's
 * context, not the host's own).
 */
export class WaveshaperEffect implements CacophonyEffect {
  constructor(
    private readonly host: WaveshaperHost,
    private readonly options: WaveshaperOptions = {},
  ) {}

  async build(context: BaseContext): Promise<AudioWorkletNode> {
    await this.host.loadWaveshaper(undefined, context);
    return this.host.createWaveshaperNode({ parameterData: this.options as Record<string, number> }, context);
  }
}

/**
 * Construction-time configuration for a {@link FoaDecoder}.
 */
export interface FoaDecoderOptions {
  /**
   * Caller-supplied order-1 SH-HRIR. When omitted, the decoder resolves the
   * bundled Omnitone `sh_hrir_order_1.wav` (Apache-2.0) via
   * {@link FoaDecoderHost.loadFoaHrir}. Supply a 4-channel `AudioBuffer` (ACN
   * rows W,Y,Z,X) to override — e.g. in tests, or to ship a different
   * measured SH-HRIR. If you substitute a different file the WY/ZX row
   * grouping and the Y right-ear sign inversion must still match Omnitone's
   * convention (see {@link FoaDecoder}).
   */
  hrir?: AudioBuffer;
}

/**
 * Standalone 4-channel-in / 2-channel-out FOA → binaural FORMAT CONVERTER,
 * built entirely from native Web Audio nodes (NO worklet).
 *
 * ## Why this is NOT a `CacophonyEffect`
 * A `CacophonyEffect` (and the `Bus.addFilter` chain) assumes ONE node that is
 * both the input the chain connects into and the output it connects out of
 * (see the module docstring above). A FOA decoder cannot satisfy that contract:
 * its input is a **4-channel** FOA node and its output is a **2-channel**
 * binaural node — two distinct nodes with different channel counts. Squeezing
 * it into `build(): AudioNode` forced the head splitter to masquerade as both,
 * so downstream routing read the 4-channel splitter, not the stereo tail.
 *
 * Instead this is a standalone construct exposing the two endpoints explicitly:
 *   - {@link input}  — the 4-channel `ChannelSplitterNode` you feed FOA into.
 *   - {@link output} — the 2-channel binaural `GainNode` you route downstream.
 *
 * Wire it EXPLICITLY (it is NOT a bus filter):
 * ```ts
 *   const decoder = await cacophony.createFoaDecoder();
 *   foaSourceNode.connect(decoder.input);          // 4-ch FOA in
 *   decoder.output.connect(bus.input /* or context.destination *\/); // stereo out
 * ```
 *
 * ## Math (Ahrens 2022, eq. 31)
 * Under a real (SN3D/ACN) SH basis the binaural decode collapses to a single
 * per-EAR multiply-accumulate over ALL the SH channels:
 *   B^{L,R}(w) = sum_{n,m} S_{n,m}(w) * H_{n,m}^{L,R}(w)
 * (Ahrens, "Binaural Audio Rendering in the Spherical Harmonic Domain", 2022,
 * eq. 31 — the real-basis form where the conjugation and m -> -m degree flip
 * vanish). EACH ear sums the contribution of EVERY FOA channel (W, Y, Z, X)
 * convolved with that ear's HRIR — neither ear may drop a channel. With a
 * single stored SH-HRIR the L/R-symmetric channels (W, Z, X) share the same
 * coefficient for both ears while the L/R-ANTISYMMETRIC channel (Y) is the
 * sign-flip for the right ear, so:
 *   B^L = W*H_W + Y*H_Y + Z*H_Z + X*H_X
 *   B^R = W*H_W - Y*H_Y + Z*H_Z + X*H_X   (only the Y term differs, by sign)
 *
 * ## Topology (Omnitone WY/ZX packing — GoogleChrome/omnitone foa-convolver.js)
 * Rather than 8 mono convolvers, the four SH channels are grouped into two
 * STEREO `ConvolverNode`s — W+Y into one, Z+X into the other — each convolved
 * against a 2-row slice of the 4-row SH-HRIR. A 4-channel ConvolverNode would
 * do unwanted cross-channel convolution per the Web Audio spec; the stereo
 * packing is Omnitone's production graph and is mirrored here VERBATIM (the
 * `.connect` calls below are line-for-line Omnitone's `_buildAudioGraph`):
 *
 *   input (ChannelSplitter, 4ch)
 *     ch0(W),ch1(Y) -> mergerWY(2ch) -> convolverWY (HRIR rows {W,Y}, stereo)
 *     ch2(Z),ch3(X) -> mergerZX(2ch) -> convolverZX (HRIR rows {Z,X}, stereo)
 *   convolverWY -> splitterWY(2ch); convolverZX -> splitterZX(2ch)
 *     splitterWY.ch0 (W) -> L AND R
 *     splitterWY.ch1 (Y) -> L,   and (via -1 inverter) -> R
 *     splitterZX.ch0 (Z) -> L AND R
 *     splitterZX.ch1 (X) -> L AND R
 *   mergerBinaural(2ch) -> output (stereo)
 *
 * The result is exactly eq.31: BOTH ears receive ALL four SH channels; only the
 * Y channel's right-ear contribution is sign-flipped by a `GainNode(-1)`,
 * because Y is the sole left/right-antisymmetric FOA channel. (This is the fix
 * for the prior broken graph, which sent only W+Z to the left ear and only
 * -Y+X to the right — each ear missing two channels.) `convolver.normalize` is
 * set `false` on both: the SH-HRIR is already correctly scaled and Web Audio
 * convolver normalization would corrupt it.
 *
 * ## Normalization (SN3D end-to-end — NO sqrt(3) rescale)
 * The decoder, the bundled Omnitone HRIR, and {@link encodeMonoToFoaSN3D} are
 * ALL SN3D. The decode is the plain MAC of two SN3D-matched coefficient sets,
 * so NO per-channel sqrt(3) (N3D<->SN3D) rescale is applied — inserting one
 * would double-normalize.
 *
 * NOTE on the resurrection path: the dormant `StereoToFoaUpmixer`
 * (`createStereoToBFormatNode`) emits ACN `[W,Y,Z,X]` but is a perceptual,
 * frequency-banded, coherence-gated mix with per-channel non-constant gain — it
 * is NEITHER N3D nor SN3D and no single normalization bridge exists. Its 4-ch
 * output plugs straight into {@link input} (ACN ordering already lines up), and
 * the resulting binaural is a documented PERCEPTUAL APPROXIMATION, not a
 * physically-correct sound field. The clean, physically-correct path is
 * {@link encodeMonoToFoaSN3D} -> this decoder.
 */
export class FoaDecoder {
  /** The 4-channel FOA `[W, Y, Z, X]` (ACN) entry node. Feed FOA into this. */
  readonly input: AudioNode;
  /** The 2-channel binaural stereo node. Route THIS downstream. */
  readonly output: AudioNode;

  private constructor(input: AudioNode, output: AudioNode) {
    this.input = input;
    this.output = output;
  }

  /**
   * Builds the live decode graph against `context`, resolving the SH-HRIR
   * (caller-supplied or bundled Omnitone) and wiring the Omnitone WY/ZX graph.
   * Async because the bundled HRIR is fetched + `decodeAudioData`-d.
   */
  static async create(
    host: FoaDecoderHost,
    options: FoaDecoderOptions = {},
    context?: BaseContext,
  ): Promise<FoaDecoder> {
    const ctx = context ?? host.defaultContext();
    if (!ctx.createChannelSplitter || !ctx.createChannelMerger || !ctx.createConvolver) {
      throw new Error("FoaDecoder requires createChannelSplitter, createChannelMerger and createConvolver");
    }

    // SN3D SH-HRIR (4 rows: ACN W,Y,Z,X). Caller override or bundled Omnitone.
    const hrir = options.hrir ?? (await host.loadFoaHrir(ctx));

    // Input: 4-channel FOA [W, Y, Z, X] (ACN). Externally-visible input node.
    const input = ctx.createChannelSplitter(4);

    // --- WY / ZX stereo grouping (Omnitone foa-convolver.js) ---
    const mergerWY = ctx.createChannelMerger(2);
    const mergerZX = ctx.createChannelMerger(2);
    // W(ch0)->mergerWY in0, Y(ch1)->mergerWY in1
    input.connect(mergerWY, 0, 0);
    input.connect(mergerWY, 1, 1);
    // Z(ch2)->mergerZX in0, X(ch3)->mergerZX in1
    input.connect(mergerZX, 2, 0);
    input.connect(mergerZX, 3, 1);

    const convolverWY = ctx.createConvolver();
    const convolverZX = ctx.createConvolver();
    // The SH-HRIR is already correctly scaled; Web Audio convolver
    // normalization would corrupt it (Omnitone sets disableNormalization=true).
    convolverWY.normalize = false;
    convolverZX.normalize = false;
    convolverWY.buffer = FoaDecoder.sliceHrirRows(ctx, hrir, 0, 1); // {W, Y} rows
    convolverZX.buffer = FoaDecoder.sliceHrirRows(ctx, hrir, 2, 3); // {Z, X} rows
    mergerWY.connect(convolverWY);
    mergerZX.connect(convolverZX);

    // --- Per-ear sum (Ahrens eq.31 MAC, executed by the convolver graph) ---
    // This is Omnitone foa-convolver.js _buildAudioGraph VERBATIM: both convolved
    // SH-channel pairs fan into BOTH ears, so each ear sums all four SH channels;
    // only the Y (splitterWY ch1) right-ear path is inverted.
    const splitterWY = ctx.createChannelSplitter(2);
    const splitterZX = ctx.createChannelSplitter(2);
    convolverWY.connect(splitterWY);
    convolverZX.connect(splitterZX);

    const mergerBinaural = ctx.createChannelMerger(2);
    const yRightInverter = ctx.createGain();
    yRightInverter.gain.value = -1;

    // W (splitterWY ch0) -> L (in0) and R (in1)
    splitterWY.connect(mergerBinaural, 0, 0);
    splitterWY.connect(mergerBinaural, 0, 1);
    // Y (splitterWY ch1) -> L (in0) directly; -> R (in1) through the -1 inverter
    splitterWY.connect(mergerBinaural, 1, 0);
    splitterWY.connect(yRightInverter, 1, 0);
    yRightInverter.connect(mergerBinaural, 0, 1);
    // Z (splitterZX ch0) -> L (in0) and R (in1)
    splitterZX.connect(mergerBinaural, 0, 0);
    splitterZX.connect(mergerBinaural, 0, 1);
    // X (splitterZX ch1) -> L (in0) and R (in1)
    splitterZX.connect(mergerBinaural, 1, 0);
    splitterZX.connect(mergerBinaural, 1, 1);

    const output = ctx.createGain();
    mergerBinaural.connect(output);

    return new FoaDecoder(input, output);
  }

  /**
   * Builds a 2-channel `AudioBuffer` from rows `rowA`/`rowB` of the 4-row
   * SH-HRIR — the stereo buffer a WY or ZX `ConvolverNode` convolves against.
   * Falls back to the source buffer unchanged when the runtime cannot allocate
   * a buffer or the source lacks the rows (e.g. a stubbed mock buffer in tests
   * with fewer channels): the graph wiring is unaffected.
   */
  private static sliceHrirRows(context: BaseContext, hrir: AudioBuffer, rowA: number, rowB: number): AudioBuffer {
    if (!context.createBuffer || hrir.numberOfChannels < rowB + 1) {
      return hrir;
    }
    const stereo = context.createBuffer(2, hrir.length, hrir.sampleRate);
    stereo.copyToChannel(hrir.getChannelData(rowA), 0);
    stereo.copyToChannel(hrir.getChannelData(rowB), 1);
    return stereo;
  }
}

/**
 * Type guard for the structural shape `CacophonyEffect`. A value qualifies if
 * it exposes a callable `build` property.
 */
export function isCacophonyEffect(value: unknown): value is CacophonyEffect {
  return (
    typeof value === "object" &&
    value !== null &&
    "build" in value &&
    typeof (value as { build: unknown }).build === "function"
  );
}
