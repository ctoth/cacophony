/**
 * Bus — a named summing node with its own filter chain and per-edge gain.
 *
 * A Bus is a first-class routing primitive. Sounds and synths route into a
 * bus via `routeTo`; the bus mixes its inputs through an optional filter
 * chain and emits to one or more downstream targets (other buses or the
 * master bus). Connections out can be either unity-gain (direct) or
 * attenuated through an allocated GainNode (per-edge gain).
 *
 * Internal topology:
 *     input → [filter1 → ... → filterN] → output → (sends to targets)
 *
 * `input` and `output` are separate GainNodes so the chain has a stable
 * external interface even as the internal filter chain is rebuilt.
 *
 * Buses are SHARED LIVE — there is no per-playback clone. The filter chain
 * holds the live node instances added via `addFilter`. Adding the same
 * filter to two buses means the same Web Audio node is used; mutating its
 * parameters affects both.
 */

import type { FadeType } from "./cacophony";
import type { AudioNode, BaseContext, BiquadFilterNode, GainNode } from "./context";
import { EffectChain } from "./effectChain";
import type { BuiltEffect, CacophonyEffect } from "./effects";
import { isBuiltEffectGraph, isCacophonyBuiltBiquad, isCacophonyEffect } from "./effects";

/**
 * Connection target for {@link Bus.connect} / {@link Bus.disconnect}. Either
 * another Bus (we connect into its `input`) or a raw AudioNode (we connect
 * directly to it — escape hatch for advanced wiring).
 */
export type BusConnectionTarget = Bus | AudioNode;

/**
 * Structural contract a routed source (e.g. a {@link Sound}) implements so a
 * Bus can move it off itself before teardown. Declared here — rather than
 * importing `Sound` — to avoid an import cycle (`sound.ts` already imports
 * `Bus`). A Bus only ever needs this one method on its inbound sources.
 */
export interface BusRoutedSource {
  /**
   * Called by {@link Bus.drainTo} to move this source off the draining bus
   * onto `target`. The source reroutes its primary route and/or any send that
   * targeted `bus`.
   */
  _onBusDrained(bus: Bus, target: Bus): void;
}

/**
 * A named summing node with a filter chain and per-edge send gain. See
 * module-level docstring for topology.
 */
export class Bus {
  /** Stable name for registry lookup, or null for anonymous buses. */
  readonly name: string | null;

  /**
   * Entry node — connect upstream sources here (sound playbacks, other bus
   * outputs).
   */
  readonly input: GainNode;

  /**
   * Exit node — connected to downstream targets (other bus inputs, master,
   * raw nodes) via {@link connect}.
   */
  readonly output: GainNode;

  private readonly _context: BaseContext;
  private readonly _effectChain: EffectChain;
  private readonly _sendGains: Map<BusConnectionTarget, GainNode> = new Map();
  private readonly _directConnections: Set<BusConnectionTarget> = new Set();
  /**
   * Inbound sources currently routed to this bus (primary route and/or sends).
   * A Web Audio node cannot enumerate its own inputs, so sources register
   * themselves here (via {@link _registerRoutedSource}) when they route to
   * this bus and unregister on reroute/cleanup. {@link drainTo} walks this set
   * to move live sounds off the bus before it is torn down.
   */
  private readonly _routedSources = new Set<BusRoutedSource>();
  /**
   * Hook invoked by the owning Cacophony instance to remove this bus from
   * the named-bus registry on destroy. Anonymous buses leave this undefined.
   */
  private readonly _onDestroy?: () => void;
  private readonly _destroyable: boolean;
  private _destroyed = false;

  /**
   * @param context Web Audio context the bus's nodes live on.
   * @param name Name to register under, or null for an anonymous bus.
   * @param input Optional pre-existing GainNode to use as the input. Used by
   *   the `master` bus to alias `cacophony.globalGainNode`. If omitted, a
   *   fresh GainNode is allocated.
   * @param onDestroy Optional registry-cleanup hook fired by destroy().
   * @param destroyable Whether destroy() may tear down this bus.
   */
  constructor(
    context: BaseContext,
    name: string | null = null,
    input?: GainNode,
    onDestroy?: () => void,
    destroyable = true,
  ) {
    this._context = context;
    this.name = name;
    this.input = input ?? context.createGain();
    this.output = context.createGain();
    this._onDestroy = onDestroy;
    this._destroyable = destroyable;
    this._effectChain = new EffectChain(this.input, this.output, "Bus");
  }

  /** True after {@link destroy} has been called. */
  get destroyed(): boolean {
    return this._destroyed;
  }

  /** Output node gain — controls the overall level the bus sends downstream. */
  get gain(): number {
    return this.output.gain.value;
  }

  set gain(v: number) {
    this.output.gain.value = v;
  }

  /** Live filter chain (read-only view). */
  get filters(): readonly AudioNode[] {
    return this._effectChain.nodes;
  }

  /**
   * Add a filter node to the bus's chain. Accepts:
   *
   * - A Cacophony-built BiquadFilterNode (created via
   *   `cacophony.createBiquadFilter`) → added directly to the chain.
   * - A {@link CacophonyEffect} → `build(context)` is awaited; the resulting
   *   node is added to the chain.
   * - A raw third-party AudioNode → REJECTED. Wrap it with
   *   `cacophony.shareEffect(node)` (or a proper CacophonyEffect class) to
   *   make the shared-state intent explicit.
   *
   * @returns the built AudioNode that was added to the chain. For a biquad this
   *   is the argument itself; for a {@link CacophonyEffect} it is the node
   *   produced by `build`. The returned handle can be passed to
   *   {@link rampFilterParam} to automate the node's parameters. Existing
   *   callers that ignore the result keep working unchanged.
   * @throws if the bus has been destroyed, or if the argument is a raw
   *   AudioNode that is not a Cacophony-built biquad.
   */
  async addFilter(arg: BiquadFilterNode | CacophonyEffect | AudioNode): Promise<AudioNode> {
    this._throwIfDestroyed();
    let built: BuiltEffect;
    if (isCacophonyBuiltBiquad(arg)) {
      built = arg;
    } else if (isCacophonyEffect(arg)) {
      built = await arg.build(this._context);
    } else {
      throw new Error(
        "Bus.addFilter rejects raw AudioNodes. Wrap with cacophony.shareEffect(node) or a CacophonyEffect to make the shared-state intent explicit.",
      );
    }
    const handle = isBuiltEffectGraph(built) ? (built.handle ?? built.input) : built;
    if (this._effectChain.has(handle)) {
      throw new Error("Cannot add the same filter node to a bus twice");
    }
    return this._effectChain.add(built);
  }

  /**
   * Remove a filter node from the bus's chain. The node must have been added
   * via {@link addFilter}; the same object identity is used to match.
   *
   * @throws if the bus has been destroyed or if the node was never added.
   */
  removeFilter(node: AudioNode): void {
    this._throwIfDestroyed();
    if (!this._effectChain.has(node)) {
      throw new Error("Cannot remove filter that was never added to this bus");
    }
    this._effectChain.remove(node);
  }

  /**
   * Reorder the existing filter chain. `nodes` must be a PERMUTATION of the
   * current filters — the same set of node objects (matched by identity), the
   * same length, with no duplicates — just in a new order. Because the owned
   * {@link EffectChain} reconciles incrementally, only the edges that actually
   * move are reconnected; unchanged edges are left untouched.
   *
   * @throws if the bus has been destroyed, or if `nodes` is not a permutation
   *   of the current filters.
   */
  setFilterOrder(nodes: readonly AudioNode[]): void {
    this._throwIfDestroyed();
    const isPermutation =
      nodes.length === this._effectChain.nodes.length &&
      new Set(nodes).size === nodes.length &&
      nodes.every((node) => this._effectChain.has(node));
    if (!isPermutation) {
      throw new Error("setFilterOrder requires a permutation of the current filters");
    }
    this._effectChain.setOrder(nodes);
  }

  /**
   * Bypass (or un-bypass) a filter without removing it from the chain. A
   * bypassed filter stays in {@link filters} — its order, identity, and live
   * AudioParams are preserved (so an automation target survives a bypass) — but
   * it is skipped in the audible series chain: the signal is wired around it.
   * Un-bypassing wires it back in at its original position.
   *
   * The reconnect goes through the incremental {@link EffectChain}, so only the
   * seam around `node` is touched — the rest of the chain is left connected.
   *
   * @param node A filter node currently on this bus (from {@link addFilter} or
   *   {@link filters}).
   * @param bypassed `true` to skip the node, `false` to wire it back in. A no-op
   *   if the node is already in the requested state.
   * @throws if the bus has been destroyed, or if `node` was never added to this
   *   bus.
   */
  setFilterBypassed(node: AudioNode, bypassed: boolean): void {
    this._throwIfDestroyed();
    if (!this._effectChain.has(node)) {
      throw new Error("Cannot bypass a filter that was never added to this bus");
    }
    this._effectChain.setBypassed(node, bypassed);
  }

  /**
   * Whether `node` is currently bypassed (skipped in the audible chain). Returns
   * `false` for nodes that were never added to this bus.
   */
  isFilterBypassed(node: AudioNode): boolean {
    return this._effectChain.isBypassed(node);
  }

  /**
   * Ramp an effect node's parameter to a target value over time. This is the
   * uniform automation handle for filter-chain effects: pass a node obtained
   * from {@link addFilter} (or the {@link filters} getter) and the name of the
   * parameter to drive.
   *
   * Parameter resolution:
   * - If `node` exposes a worklet-style `parameters` AudioParamMap, the param
   *   is resolved via `parameters.get(paramName)` (e.g. a worklet effect's
   *   named params).
   * - Otherwise, if `node[paramName]` is itself an AudioParam (native nodes
   *   such as a biquad expose `.frequency` / `.Q` / `.gain` directly), that is
   *   used.
   *
   * Ramp shape (mirrors the codebase fade convention): the target time base is
   * `node.context.currentTime`. With no `duration` (or `duration <= 0`) the
   * value is set immediately via `setValueAtTime(value, now)`. Otherwise the
   * start is pinned with `setValueAtTime(param.value, now)` and the value ramps
   * to `now + duration / 1000` (milliseconds) using `linearRampToValueAtTime`
   * (default) or `exponentialRampToValueAtTime` when `type` is `"exponential"`
   * (an exponential target of 0 is floored to 0.0001, matching `fadeTo`).
   *
   * Automation degrades gracefully: if `node` is not on this bus, or the
   * parameter cannot be resolved to an AudioParam, a warning is logged and the
   * call is a no-op. The only condition that throws is a destroyed bus.
   *
   * @param node A filter node currently on this bus (from {@link addFilter}).
   * @param paramName The name of the parameter to automate.
   * @param value The target value.
   * @param options.duration Ramp duration in milliseconds. Absent/`<= 0` sets
   *   the value immediately.
   * @param options.type Ramp curve, `"linear"` (default) or `"exponential"`.
   * @throws if the bus has been destroyed.
   */
  rampFilterParam(
    node: AudioNode,
    paramName: string,
    value: number,
    options?: { duration?: number; type?: FadeType },
  ): void {
    this._throwIfDestroyed();
    this._effectChain.rampParam(node, paramName, value, options);
  }

  /**
   * Connect this bus's output to another bus or to a raw AudioNode.
   *
   * If `gain` is omitted or equal to 1, connect directly (output →
   * targetInput). If `gain` is provided, allocate an internal GainNode for
   * per-edge attenuation: output → sendGain → targetInput. The sendGain is
   * tracked so {@link disconnect} can tear it down cleanly.
   *
   * Re-connecting a target that is already wired is a no-op for the direct
   * case; for a gained connection, the existing sendGain's `gain.value` is
   * updated in place (no new edge is allocated).
   *
   * @throws if the bus has been destroyed.
   */
  connect(target: BusConnectionTarget, gain?: number): void {
    this._throwIfDestroyed();
    const targetNode = target instanceof Bus ? target.input : target;
    if (gain === undefined || gain === 1) {
      if (this._directConnections.has(target)) {
        return;
      }
      // If a gained connection exists, tear it down first so the connection
      // mode is unambiguous.
      const existingSend = this._sendGains.get(target);
      if (existingSend) {
        try {
          this.output.disconnect(existingSend);
        } catch {}
        try {
          existingSend.disconnect();
        } catch {}
        this._sendGains.delete(target);
      }
      this.output.connect(targetNode);
      this._directConnections.add(target);
      return;
    }
    const existingSend = this._sendGains.get(target);
    if (existingSend) {
      existingSend.gain.value = gain;
      return;
    }
    // Tear down any direct edge first (so the routing topology to this
    // target stays unambiguous).
    if (this._directConnections.has(target)) {
      try {
        this.output.disconnect(targetNode);
      } catch {}
      this._directConnections.delete(target);
    }
    const sendGain = this._context.createGain();
    sendGain.gain.value = gain;
    this.output.connect(sendGain);
    sendGain.connect(targetNode);
    this._sendGains.set(target, sendGain);
  }

  /**
   * Disconnect this bus's output from a target previously connected with
   * {@link connect}. Tears down the allocated sendGain (if any). No-op if
   * the target was never connected.
   *
   * @throws if the bus has been destroyed.
   */
  disconnect(target: BusConnectionTarget): void {
    this._throwIfDestroyed();
    const targetNode = target instanceof Bus ? target.input : target;
    const sendGain = this._sendGains.get(target);
    if (sendGain) {
      try {
        this.output.disconnect(sendGain);
      } catch {}
      try {
        sendGain.disconnect();
      } catch {}
      this._sendGains.delete(target);
    }
    if (this._directConnections.has(target)) {
      try {
        this.output.disconnect(targetNode);
      } catch {}
      this._directConnections.delete(target);
    }
  }

  /**
   * Register an inbound source that routes to this bus (primary and/or send).
   * Called by the source when it begins routing here. Idempotent (Set). Safe
   * to call without a destroyed guard — registration during normal routing
   * must never throw — but a destroyed bus has nothing to drain, so this
   * early-returns once destroyed.
   *
   * @internal
   */
  _registerRoutedSource(source: BusRoutedSource): void {
    if (this._destroyed) {
      return;
    }
    this._routedSources.add(source);
  }

  /**
   * Unregister an inbound source (it rerouted away or was cleaned up). No-op
   * if the source was never registered.
   *
   * @internal
   */
  _unregisterRoutedSource(source: BusRoutedSource): void {
    this._routedSources.delete(source);
  }

  /**
   * Move every source currently routed to this bus onto `target`, so live
   * sounds keep feeding a live bus instead of the dead `input` after this bus
   * is torn down. Each registered source's {@link BusRoutedSource._onBusDrained}
   * reroutes its primary route and/or the send that targeted this bus.
   *
   * @throws if this bus has been destroyed, or if `target` is this bus.
   */
  drainTo(target: Bus): void {
    this._throwIfDestroyed();
    if (target === this) {
      throw new Error("Cannot drain a bus to itself");
    }
    for (const source of [...this._routedSources]) {
      source._onBusDrained(this, target);
    }
    this._routedSources.clear();
  }

  /**
   * Tear down the bus — disconnects input, output, every send-gain, every
   * filter, then deregisters from the owner Cacophony's named-bus map.
   * Subsequent `addFilter`/`removeFilter`/`connect`/`disconnect` calls throw.
   *
   * If `options.drainTo` is provided, every source routed to this bus is first
   * rerouted onto that bus (via {@link drainTo}) so live sounds keep playing
   * through a live bus. With no options the default teardown is unchanged:
   * sounds routed to the destroyed bus fall back to master on their next
   * playback (the routeTo machinery checks `destroyed` at preplay).
   */
  destroy(options?: { drainTo?: Bus }): void {
    if (!this._destroyable) {
      throw new Error("The master bus cannot be destroyed");
    }
    if (this._destroyed) {
      return;
    }
    if (options?.drainTo) {
      this.drainTo(options.drainTo);
    }
    this._destroyed = true;
    // Tear down all outgoing send-gain allocations.
    for (const [, sendGain] of this._sendGains) {
      try {
        sendGain.disconnect();
      } catch {}
    }
    this._sendGains.clear();
    this._directConnections.clear();
    // Disconnect only this bus's internal chain edges. Filter nodes may be
    // shared with other buses, so broad node.disconnect() would steal their
    // routes.
    this._effectChain.destroy();
    try {
      this.input.disconnect();
    } catch {}
    try {
      this.output.disconnect();
    } catch {}
    this._onDestroy?.();
  }

  private _throwIfDestroyed(): void {
    if (this._destroyed) {
      throw new Error(`Bus '${this.name ?? "<anonymous>"}' has been destroyed`);
    }
  }
}
