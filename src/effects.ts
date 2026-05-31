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

import type { AudioNode, AudioWorkletNode, BaseContext, BiquadFilterNode } from "./context";

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
