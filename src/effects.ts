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

import type { AudioNode, BaseContext, BiquadFilterNode } from "./context";

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
