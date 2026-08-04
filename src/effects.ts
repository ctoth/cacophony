/**
 * Cacophony Effects: a thin abstraction over Web Audio nodes that lets a Bus
 * carry shared processing or a playback build an independent source effect.
 *
 * A {@link CacophonyEffect} is responsible for producing a live AudioNode or
 * endpoint graph when its `build` method is invoked. Single-node effects return
 * the node directly. Multi-node effects return a {@link BuiltEffectGraph} with
 * distinct `input` and `output` endpoints so effect chains can connect into and out
 * of the graph without pretending the head node is also the tail.
 *
 * The `build` return is async-capable so worklet-backed effects (e.g.
 * DattorroReverb) can `await` their AudioWorklet module load before
 * constructing the node, while pure-DOM effects (BiquadFilter, simple GainNode
 * wrappers, ConvolverNode graphs) can return synchronously.
 */

import type { AudioBuffer, AudioNode, AudioParam, AudioWorkletNode, BaseContext, BiquadFilterNode } from "./context";
import type { WorkletModule } from "./worklets";
import { WORKLETS } from "./worklets";

/**
 * The single structural surface every worklet-backed {@link CacophonyEffect}
 * needs from its host (a {@link Cacophony} instance). Declared locally so this
 * module avoids a circular import on cacophony.ts. `buildWorkletEffect`
 * idempotently registers the worklet module on `context` (or the host's own
 * context when omitted — the cross-context contract `build(context)` promises)
 * and constructs the node with the supplied `parameterData`.
 */
export interface WorkletEffectHost {
  buildWorkletEffect(
    worklet: WorkletModule,
    parameterData: Record<string, number>,
    context?: BaseContext,
    nodeOptions?: AudioWorkletNodeOptions,
  ): Promise<AudioWorkletNode>;
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
 * Minimal structural interface for loading URL-backed impulse responses without
 * importing `Cacophony` into this module.
 */
interface ImpulseResponseHost {
  loadImpulseResponseBuffer(url: string, context: BaseContext, signal?: AbortSignal): Promise<AudioBuffer>;
}

/**
 * A built effect graph with distinct endpoints. `input` is where the previous
 * Bus chain entry connects, and `output` is where the next entry connects.
 * `handle` is the public AudioNode identity returned by `Bus.addFilter()` and
 * exposed through `Bus.filters`; when omitted the bus uses `input`.
 */
export interface BuiltEffectGraph {
  input: AudioNode;
  output: AudioNode;
  handle?: AudioNode;
  params?: Readonly<Record<string, AudioParam>>;
  dispose?: () => void;
}

export type BuiltEffect = AudioNode | BuiltEffectGraph;

/**
 * Public surface every Cacophony effect implements. `build` materializes the
 * effect's live node graph against a specific audio context. A Bus consumes an
 * effect as shared live state; a source consumes it as a recipe and calls
 * `build` once for every playback. Cacophony itself does not cache.
 */
export interface CacophonyEffect {
  build(context: BaseContext): Promise<BuiltEffect> | BuiltEffect;
}

/**
 * Base class for every worklet-backed effect. Holds the {@link WorkletModule}
 * to build and the construction-time options, and resolves the options into the
 * `parameterData` the worklet node is constructed with. `build` honors the
 * cross-context contract — it builds against the bus's `context`, not the
 * host's own — by forwarding `context` to {@link WorkletEffectHost.buildWorkletEffect}.
 *
 * Subclasses supply a {@link WorkletModule} and, when a field needs translation
 * before it can ride as an AudioParam (e.g. a string mode alias → integer index),
 * override {@link toParameterData}. The default passes the options through as a
 * numeric record, exactly as the per-effect classes did before.
 */
export abstract class WorkletEffect<O extends object> implements CacophonyEffect {
  protected constructor(
    protected readonly host: WorkletEffectHost,
    private readonly worklet: WorkletModule,
    protected readonly options: O,
  ) {}

  /**
   * Translate the construction options into worklet `parameterData`. Default:
   * pass through as a numeric record (the worklet validates/clamps downstream).
   */
  protected toParameterData(options: O): Record<string, number> {
    return { ...options } as Record<string, number>;
  }

  build(context: BaseContext): Promise<AudioWorkletNode> {
    return this.host.buildWorkletEffect(this.worklet, this.toParameterData(this.options), context);
  }
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
 * Treats a BiquadFilterNode as a per-playback recipe. Unlike BiquadEffect,
 * which intentionally shares its node, every build creates an independent
 * node and copies the template's public filter state.
 */
export class BiquadRecipeEffect implements CacophonyEffect {
  constructor(private readonly template: BiquadFilterNode) {}

  build(context: BaseContext): BiquadFilterNode {
    const node = context.createBiquadFilter();
    node.type = this.template.type;
    node.frequency.value = this.template.frequency.value;
    node.detune.value = this.template.detune.value;
    node.Q.value = this.template.Q.value;
    node.gain.value = this.template.gain.value;
    return node;
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

export type ImpulseResponseSource = AudioBuffer | string;

export interface ImpulseResponseOptions {
  /** Web Audio convolver normalization. Default false to preserve measured IR gain. */
  normalize?: boolean;
  /** Dry gain for an inline dry/wet graph. Default 0 for wet-only send-bus use. */
  dry?: number;
  /** Wet gain for the convolved path. Default 1. */
  wet?: number;
  /** Optional abort signal for URL-backed impulse-response loading. */
  signal?: AbortSignal;
}

/**
 * Native ConvolverNode impulse-response effect. Wet-only construction returns a
 * single ConvolverNode and is intended for send buses. Supplying `dry` or a
 * non-unity `wet` builds an owned dry/wet graph with exposed `dry` and `wet`
 * gain AudioParams.
 */
export class ImpulseResponseEffect implements CacophonyEffect {
  constructor(
    private readonly host: ImpulseResponseHost,
    private readonly source: ImpulseResponseSource,
    private readonly options: ImpulseResponseOptions = {},
  ) {}

  async build(context: BaseContext): Promise<BuiltEffect> {
    if (!context.createConvolver) {
      throw new Error("ImpulseResponseEffect requires createConvolver");
    }

    const buffer =
      typeof this.source === "string"
        ? await this.host.loadImpulseResponseBuffer(this.source, context, this.options.signal)
        : this.source;
    const convolver = context.createConvolver();
    convolver.normalize = this.options.normalize ?? false;
    convolver.buffer = buffer;

    const dry = this.options.dry ?? 0;
    const wet = this.options.wet ?? 1;
    if (dry === 0 && wet === 1) {
      return convolver;
    }

    const input = context.createGain();
    const dryGain = context.createGain();
    const wetGain = context.createGain();
    const output = context.createGain();
    dryGain.gain.value = dry;
    wetGain.gain.value = wet;

    input.connect(dryGain);
    dryGain.connect(output);
    input.connect(convolver);
    convolver.connect(wetGain);
    wetGain.connect(output);

    return {
      input,
      output,
      handle: input,
      params: { dry: dryGain.gain, wet: wetGain.gain },
      dispose: () => {
        try {
          input.disconnect(dryGain);
        } catch {}
        try {
          dryGain.disconnect(output);
        } catch {}
        try {
          input.disconnect(convolver);
        } catch {}
        try {
          convolver.disconnect(wetGain);
        } catch {}
        try {
          wetGain.disconnect(output);
        } catch {}
      },
    };
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
export class ReverbEffect extends WorkletEffect<ReverbOptions> {
  constructor(host: WorkletEffectHost, options: ReverbOptions = {}) {
    super(host, WORKLETS.dattorroReverb, options);
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
export class DynamicsEffect extends WorkletEffect<DynamicsOptions> {
  constructor(host: WorkletEffectHost, options: DynamicsOptions = {}) {
    super(host, WORKLETS.dynamics, options);
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
export class FdnReverbEffect extends WorkletEffect<FdnReverbOptions> {
  constructor(host: WorkletEffectHost, options: FdnReverbOptions = {}) {
    super(host, WORKLETS.fdnReverb, options);
  }
}

/**
 * String aliases for the integer mode indices that {@link WaveshaperOptions},
 * {@link TremoloOptions} and {@link ModulatedDelayOptions} flow straight through
 * as `parameterData`. An AudioParam can only carry a number, so these maps are
 * applied inside each effect's `build()` to translate a string mode into its
 * integer index BEFORE the options become `parameterData`. The index assignments
 * mirror the worklet shells' `*_BY_INDEX` arrays exactly
 * (`processors/waveshaper.ts`, `processors/tremolo.ts`,
 * `processors/modulated-delay.ts`). Declared locally so this module does not
 * import from the worklet/processor modules (keeping that boundary intact).
 */
const WAVESHAPER_SHAPE_TO_INDEX = { hardclip: 0, tanh: 1 } as const;
type WaveshaperShapeAlias = keyof typeof WAVESHAPER_SHAPE_TO_INDEX;

const TREMOLO_SHAPE_TO_INDEX = { sine: 0, triangle: 1, square: 2 } as const;
type TremoloShapeAlias = keyof typeof TREMOLO_SHAPE_TO_INDEX;

const MODULATED_DELAY_INTERPOLATION_TO_INDEX = { cubic: 0, linear: 1 } as const;
type ModulatedDelayInterpolationAlias = keyof typeof MODULATED_DELAY_INTERPOLATION_TO_INDEX;

/**
 * Resolve a mode field that may be a number (pass through unchanged, exactly as
 * today) or a string alias (translate to its integer index). An unknown/invalid
 * string maps to index 0, mirroring the worklet's `?? first` fallback. Returns
 * `undefined` when the field is absent so the worklet keeps its own default.
 */
function resolveModeIndex(value: number | string | undefined, table: Record<string, number>): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  return table[value] ?? 0;
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
  /**
   * Nonlinearity: 0 = hard clip (polynomial F0, eq.25), 1 = tanh soft clip
   * (F0 = log cosh, eq.20). Default 0. Accepts either the integer index or the
   * matching string alias (`"hardclip"` = 0, `"tanh"` = 1), translated to the
   * index in `build()`.
   */
  shape?: number | WaveshaperShapeAlias;
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
export class WaveshaperEffect extends WorkletEffect<WaveshaperOptions> {
  constructor(host: WorkletEffectHost, options: WaveshaperOptions = {}) {
    super(host, WORKLETS.waveshaper, options);
  }

  protected override toParameterData(options: WaveshaperOptions): Record<string, number> {
    const parameterData = { ...options } as Record<string, number>;
    const shapeIndex = resolveModeIndex(options.shape, WAVESHAPER_SHAPE_TO_INDEX);
    if (shapeIndex !== undefined) {
      parameterData.shape = shapeIndex;
    }
    return parameterData;
  }
}

/**
 * Construction-time configuration for a {@link ModulatedDelayEffect}, mirroring
 * the `modulated-delay` AudioWorkletProcessor's AudioParam set (see
 * {@link import('./processors/modulated-delay').ModulatedDelayWorkletProcessor}).
 * All fields are optional; the worklet clamps to its documented ranges
 * downstream. Field NAMES match the AudioParam names exactly (they flow straight
 * through as `parameterData`).
 *
 * The effect is Dattorro's unified modulated-delay circuit (JAES 1997, Fig. 36)
 * with Lagrange FIR fractional-delay interpolation (Laakso 1996). One topology —
 * dry (`blend`) + a modulated wet tap (`feedforward`) + feedback on a FIXED
 * center tap — yields delay/echo, chorus, flanger, vibrato and doubling from
 * knob presets (Table 6). The `createDelay`/`createChorus`/`createFlanger`/
 * `createVibrato`/`createDoubling` factories are presets over these params.
 */
export interface ModulatedDelayOptions {
  /** Nominal (center) delay in ms — the fixed feedback tap center. Default 5. Range 0..1000. */
  delayTime?: number;
  /** Peak LFO delay excursion in ms (CHORUS_WIDTH); 0 = pure delay. Default 0. Range 0..50. */
  depth?: number;
  /** LFO rate f_e in Hz. Default 0.5. Range 0..20. */
  rate?: number;
  /** Feedback gain on the fixed center tap. Default 0. Range -0.9999999..0.9999999. */
  feedback?: number;
  /** Dry path gain (blend). Default 1. Range 0..1. */
  blend?: number;
  /** Wet (modulated tap) gain (feedforward). Default 0.7071. Range 0..1. */
  feedforward?: number;
  /**
   * Interpolation: 0 = cubic (4-tap Lagrange N=3), 1 = linear (2-tap N=1).
   * Default 0. Accepts either the integer index or the matching string alias
   * (`"cubic"` = 0, `"linear"` = 1), translated to the index in `build()`.
   */
  interpolation?: number | ModulatedDelayInterpolationAlias;
}

/**
 * CacophonyEffect that builds a `modulated-delay` AudioWorkletNode — Dattorro's
 * unified modulated-delay circuit (JAES 1997, Fig. 36) backing
 * delay/chorus/flanger/vibrato/doubling, with Lagrange FIR fractional-delay
 * interpolation (Laakso 1996). Mirrors {@link ReverbEffect}: `build` idempotently
 * loads the worklet module on the supplied context, then constructs the node with
 * the supplied {@link ModulatedDelayOptions} as `parameterData`. Honors the
 * cross-context contract (builds against the bus's context, not the host's own).
 */
export class ModulatedDelayEffect extends WorkletEffect<ModulatedDelayOptions> {
  constructor(host: WorkletEffectHost, options: ModulatedDelayOptions = {}) {
    super(host, WORKLETS.modulatedDelay, options);
  }

  protected override toParameterData(options: ModulatedDelayOptions): Record<string, number> {
    const parameterData = { ...options } as Record<string, number>;
    const interpolationIndex = resolveModeIndex(options.interpolation, MODULATED_DELAY_INTERPOLATION_TO_INDEX);
    if (interpolationIndex !== undefined) {
      parameterData.interpolation = interpolationIndex;
    }
    return parameterData;
  }
}

/**
 * Construction-time configuration for a {@link PhaserEffect}, mirroring the
 * `phaser` AudioWorkletProcessor's AudioParam set (see
 * {@link import('./processors/phaser').PhaserWorkletProcessor}). All fields are
 * optional; the worklet clamps to its documented ranges downstream. Field NAMES
 * match the AudioParam names exactly (they flow straight through as
 * `parameterData`).
 *
 * The effect is a classic MXR/Univibe-style phaser: a cascade of first-order
 * allpass sections at a common LFO-swept break frequency, summed additively with
 * the dry signal to sweep notches through the spectrum (Smith STAN-M-21; PASP
 * §8.9). Two allpass sections make one notch.
 */
export interface PhaserOptions {
  /** Center break frequency of the allpass sections, in Hz. Default 500. Range 20..10000. */
  frequency?: number;
  /** LFO rate in Hz. Default 0.5. Range 0..20. */
  rate?: number;
  /** Log sweep depth in octaves (break freq *= 2^(depth*lfo)). Default 1.5. Range 0..4. */
  depth?: number;
  /** Number of first-order allpass sections (2 per notch). Default 4. Range 2..12. */
  stages?: number;
  /** Feedback (regeneration/resonance). Default 0. Range -0.95..0.95. */
  feedback?: number;
  /** Additive wet gain (notch depth); y = x + mix*cascade. Default 0.5. Range 0..1. */
  mix?: number;
}

/**
 * CacophonyEffect that builds a `phaser` AudioWorkletNode — a classic
 * MXR/Univibe-style allpass-cascade phase shifter (Smith STAN-M-21; PASP §8.9).
 * Mirrors {@link ReverbEffect}: `build` idempotently loads the worklet module on
 * the supplied context, then constructs the node with the supplied
 * {@link PhaserOptions} as `parameterData`. Honors the cross-context contract
 * (builds against the bus's context, not the host's own).
 */
export class PhaserEffect extends WorkletEffect<PhaserOptions> {
  constructor(host: WorkletEffectHost, options: PhaserOptions = {}) {
    super(host, WORKLETS.phaser, options);
  }
}

/**
 * Construction-time configuration for a {@link TremoloEffect}, mirroring the
 * `tremolo` AudioWorkletProcessor's AudioParam set (see
 * {@link import('./processors/tremolo').TremoloWorkletProcessor}). All fields are
 * optional; the worklet clamps to its documented ranges downstream. Field NAMES
 * match the AudioParam names exactly (they flow straight through as
 * `parameterData`).
 *
 * The effect is LFO-driven amplitude modulation (a VCA swung by an LFO) — the
 * gain swings between (1 - depth) and 1, never inverting (a true tremolo, not
 * ring modulation). Anchored to standard AM theory, the quadrature stereo LFO of
 * Dattorro 1997 (p.776), and the LFO-driven-effect framing of Mitcheltree et al.
 * (DAFx23). `stereoPhase` offsets the per-channel LFO (0 = mono, 90 = quadrature,
 * 180 = hard auto-pan).
 */
export interface TremoloOptions {
  /** LFO rate in Hz. Default 5. Range 0..20. */
  rate?: number;
  /** Modulation depth (0 = bypass, 1 = full 0..1 swing). Default 0.5. Range 0..1. */
  depth?: number;
  /**
   * LFO shape: 0 = sine, 1 = triangle, 2 = square. Default 0. Accepts either
   * the integer index or the matching string alias (`"sine"` = 0,
   * `"triangle"` = 1, `"square"` = 2), translated to the index in `build()`.
   */
  shape?: number | TremoloShapeAlias;
  /** Per-channel LFO phase offset in degrees (0 = mono, 90 = quadrature, 180 = auto-pan). Default 0. Range 0..180. */
  stereoPhase?: number;
}

/**
 * CacophonyEffect that builds a `tremolo` AudioWorkletNode — LFO-driven amplitude
 * modulation (AM theory; Dattorro 1997 p.776 quadrature stereo LFO; Mitcheltree
 * et al. DAFx23 LFO framing). Mirrors {@link ReverbEffect}: `build` idempotently
 * loads the worklet module on the supplied context, then constructs the node with
 * the supplied {@link TremoloOptions} as `parameterData`. Honors the cross-context
 * contract (builds against the bus's context, not the host's own).
 */
export class TremoloEffect extends WorkletEffect<TremoloOptions> {
  constructor(host: WorkletEffectHost, options: TremoloOptions = {}) {
    super(host, WORKLETS.tremolo, options);
  }

  protected override toParameterData(options: TremoloOptions): Record<string, number> {
    const parameterData = { ...options } as Record<string, number>;
    const shapeIndex = resolveModeIndex(options.shape, TREMOLO_SHAPE_TO_INDEX);
    if (shapeIndex !== undefined) {
      parameterData.shape = shapeIndex;
    }
    return parameterData;
  }
}

/** Options for Wardle's Hilbert-transform single-sideband frequency shifter. */
export interface FrequencyShifterOptions {
  /** Signed frequency translation in Hz. Positive shifts up; negative shifts down. Default 100. */
  frequency?: number;
  /** Wet amount (0 = latency-aligned dry, 1 = shifted). Default 1. */
  mix?: number;
}

/** Equal-Hz frequency translation that deliberately breaks harmonic ratios. */
export class FrequencyShifterEffect extends WorkletEffect<FrequencyShifterOptions> {
  constructor(host: WorkletEffectHost, options: FrequencyShifterOptions = {}) {
    super(host, WORKLETS.frequencyShifter, options);
  }
}

/** Options for the SSB spectral-delay barberpole phaser (DAFx-15 Fig. 12). */
export interface BarberpoleOptions {
  /** Signed notch travel rate and direction in Hz. Default 0.1. */
  rate?: number;
  /** Cascaded allpass count; two stages produce one notch. Default 32. */
  stages?: number;
  /** Spectral-delay allpass coefficient. -0.5 approximates octave spacing. Default -0.5. */
  coefficient?: number;
  /** Effect mix (0 = aligned dry, 1 = barberpole sum). Default 1. */
  mix?: number;
}

/** Endlessly rising/falling, warped-notch SSB barberpole phaser. */
export class BarberpoleEffect extends WorkletEffect<BarberpoleOptions> {
  constructor(host: WorkletEffectHost, options: BarberpoleOptions = {}) {
    super(host, WORKLETS.barberpole, options);
  }
}

/** Two-voice Laroche-Dolson identity-phase-locked harmonizer options. */
export interface HarmonizerOptions {
  semitonesA?: number;
  semitonesB?: number;
  gainA?: number;
  gainB?: number;
  dry?: number;
}

/** Adds two independently shifted voices in one shared STFT analysis pass. */
export class HarmonizerEffect extends WorkletEffect<HarmonizerOptions> {
  constructor(host: WorkletEffectHost, options: HarmonizerOptions = {}) {
    super(host, WORKLETS.harmonizer, options);
  }
}

/** Spectral-frame capture and indefinite phase-coherent sustain options. */
export interface SpectralFreezeOptions {
  /** >=0.5 captures/holds; automate through rampEffectParam. Default 0. */
  freeze?: number;
  /** Blend captured magnitude with the preceding three frames. Default 0.5. */
  smear?: number;
  /** Frozen wet mix. Default 1. */
  mix?: number;
}

/** Phase-continuing spectral freeze that avoids looping one static FFT frame. */
export class SpectralFreezeEffect extends WorkletEffect<SpectralFreezeOptions> {
  constructor(host: WorkletEffectHost, options: SpectralFreezeOptions = {}) {
    super(host, WORKLETS.spectralFreeze, options);
  }
}

/** Sparse velvet-noise stereo-width options. */
export interface StereoWidenerOptions {
  width?: number;
  decorrelation?: number;
  transientProtection?: number;
}

/** Mono/stereo to explicit stereo decorrelator with transient protection. */
export class StereoWidenerEffect implements CacophonyEffect {
  constructor(
    private readonly host: WorkletEffectHost,
    private readonly options: StereoWidenerOptions = {},
  ) {}

  build(context: BaseContext): Promise<AudioWorkletNode> {
    return this.host.buildWorkletEffect(
      WORKLETS.stereoWidener,
      { ...this.options } as Record<string, number>,
      context,
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      },
    );
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
 * This standalone construct exposes the two endpoints explicitly:
 *   - {@link input}  — the 4-channel `ChannelSplitterNode` you feed FOA into.
 *   - {@link output} — the 2-channel binaural `GainNode` you route downstream.
 *
 * Wire it explicitly when building custom FOA graphs:
 * ```ts
 *   const decoder = await cacophony.createFoaDecoder();
 *   foaSourceNode.connect(decoder.input);          // 4-ch FOA in
 *   decoder.output.connect(bus.input /* or context.destination *\/); // stereo out
 * ```
 *
 * For the common bus-filter case use {@link FoaDecoderEffect}, created via
 * `cacophony.createFoaDecoderEffect()`, which returns the same endpoint graph
 * through the standard `CacophonyEffect.build()` contract.
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
  private readonly ownedNodes: readonly AudioNode[];

  private constructor(input: AudioNode, output: AudioNode, ownedNodes: readonly AudioNode[]) {
    this.input = input;
    this.output = output;
    this.ownedNodes = ownedNodes;
  }

  /** Disconnects the decoder's owned native nodes. Safe to call more than once. */
  dispose(): void {
    for (const node of this.ownedNodes) {
      try {
        node.disconnect();
      } catch {}
    }
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
    if (!ctx.createChannelSplitter || !ctx.createChannelMerger || !ctx.createConvolver || !ctx.createBuffer) {
      throw new Error(
        "FoaDecoder requires createChannelSplitter, createChannelMerger, createConvolver and createBuffer",
      );
    }

    // SN3D SH-HRIR (4 rows: ACN W,Y,Z,X). Caller override or bundled Omnitone.
    const hrir = options.hrir ?? (await host.loadFoaHrir(ctx));
    if (hrir.numberOfChannels < 4) {
      throw new Error(`FoaDecoder requires an HRIR with at least 4 channels; received ${hrir.numberOfChannels}`);
    }

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

    return new FoaDecoder(input, output, [
      input,
      mergerWY,
      mergerZX,
      convolverWY,
      convolverZX,
      splitterWY,
      splitterZX,
      yRightInverter,
      mergerBinaural,
      output,
    ]);
  }

  /**
   * Builds a 2-channel `AudioBuffer` from rows `rowA`/`rowB` of the 4-row
   * SH-HRIR — the stereo buffer a WY or ZX `ConvolverNode` convolves against.
   */
  private static sliceHrirRows(context: BaseContext, hrir: AudioBuffer, rowA: number, rowB: number): AudioBuffer {
    const stereo = context.createBuffer!(2, hrir.length, hrir.sampleRate);
    stereo.copyToChannel(hrir.getChannelData(rowA), 0);
    stereo.copyToChannel(hrir.getChannelData(rowB), 1);
    return stereo;
  }
}

/**
 * `CacophonyEffect` wrapper for a FOA decoder endpoint graph. Use only on a
 * dedicated 4-channel ACN/SN3D FOA bus where the decoder is the first/only
 * filter converting the bus from FOA to stereo binaural.
 */
export class FoaDecoderEffect implements CacophonyEffect {
  constructor(
    private readonly host: FoaDecoderHost,
    private readonly options: FoaDecoderOptions = {},
  ) {}

  async build(context: BaseContext): Promise<BuiltEffectGraph> {
    const decoder = await FoaDecoder.create(this.host, this.options, context);
    return {
      input: decoder.input,
      output: decoder.output,
      handle: decoder.input,
      dispose: () => decoder.dispose(),
    };
  }
}

function isAudioNodeLike(value: unknown): value is AudioNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AudioNode).connect === "function" &&
    typeof (value as AudioNode).disconnect === "function"
  );
}

/**
 * Type guard for the endpoint-graph shape returned by multi-node effects.
 */
export function isBuiltEffectGraph(value: unknown): value is BuiltEffectGraph {
  return (
    typeof value === "object" &&
    value !== null &&
    "input" in value &&
    "output" in value &&
    isAudioNodeLike((value as { input: unknown }).input) &&
    isAudioNodeLike((value as { output: unknown }).output)
  );
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
