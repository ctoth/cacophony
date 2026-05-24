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

import type { CacophonyEffect } from "./effects";
import { isCacophonyBuiltBiquad, isCacophonyEffect } from "./effects";
import type { AudioNode, BaseContext, BiquadFilterNode, GainNode } from "./context";

/**
 * Connection target for {@link Bus.connect} / {@link Bus.disconnect}. Either
 * another Bus (we connect into its `input`) or a raw AudioNode (we connect
 * directly to it — escape hatch for advanced wiring).
 */
export type BusConnectionTarget = Bus | AudioNode;

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
  private readonly _filterNodes: AudioNode[] = [];
  private readonly _sendGains: Map<BusConnectionTarget, GainNode> = new Map();
  private readonly _directConnections: Set<BusConnectionTarget> = new Set();
  /**
   * Hook invoked by the owning Cacophony instance to remove this bus from
   * the named-bus registry on destroy. Anonymous buses leave this undefined.
   */
  private readonly _onDestroy?: () => void;
  private _destroyed = false;

  /**
   * @param context Web Audio context the bus's nodes live on.
   * @param name Name to register under, or null for an anonymous bus.
   * @param input Optional pre-existing GainNode to use as the input. Used by
   *   the `master` bus to alias `cacophony.globalGainNode`. If omitted, a
   *   fresh GainNode is allocated.
   * @param onDestroy Optional registry-cleanup hook fired by destroy().
   */
  constructor(
    context: BaseContext,
    name: string | null = null,
    input?: GainNode,
    onDestroy?: () => void,
  ) {
    this._context = context;
    this.name = name;
    this.input = input ?? context.createGain();
    this.output = context.createGain();
    this._onDestroy = onDestroy;
    this.input.connect(this.output);
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
    return this._filterNodes;
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
   * @throws if the bus has been destroyed, or if the argument is a raw
   *   AudioNode that is not a Cacophony-built biquad.
   */
  async addFilter(arg: BiquadFilterNode | CacophonyEffect | AudioNode): Promise<void> {
    this._throwIfDestroyed();
    let node: AudioNode;
    if (isCacophonyBuiltBiquad(arg)) {
      node = arg;
    } else if (isCacophonyEffect(arg)) {
      node = await arg.build(this._context);
    } else {
      throw new Error(
        "Bus.addFilter rejects raw AudioNodes. Wrap with cacophony.shareEffect(node) or a CacophonyEffect to make the shared-state intent explicit.",
      );
    }
    if (this._filterNodes.includes(node)) {
      throw new Error("Cannot add the same filter node to a bus twice");
    }
    this._filterNodes.push(node);
    this._refreshFilters();
  }

  /**
   * Remove a filter node from the bus's chain. The node must have been added
   * via {@link addFilter}; the same object identity is used to match.
   *
   * @throws if the bus has been destroyed or if the node was never added.
   */
  removeFilter(node: AudioNode): void {
    this._throwIfDestroyed();
    const idx = this._filterNodes.indexOf(node);
    if (idx === -1) {
      throw new Error("Cannot remove filter that was never added to this bus");
    }
    this._filterNodes.splice(idx, 1);
    try {
      node.disconnect();
    } catch {
      // Filter node may have been disconnected by hand; we tolerate that on
      // removal so cleanup is not blocked by a no-op disconnect throw.
    }
    this._refreshFilters();
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
   * Tear down the bus — disconnects input, output, every send-gain, every
   * filter, then deregisters from the owner Cacophony's named-bus map.
   * Subsequent `addFilter`/`removeFilter`/`connect`/`disconnect` calls throw.
   *
   * Sounds routed to a destroyed bus fall back to master on their next
   * playback (the routeTo machinery checks `destroyed` at preplay).
   */
  destroy(): void {
    if (this._destroyed) {
      return;
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
    // Disconnect every filter and the input/output nodes.
    for (const node of this._filterNodes) {
      try {
        node.disconnect();
      } catch {}
    }
    this._filterNodes.length = 0;
    try {
      this.input.disconnect();
    } catch {}
    try {
      this.output.disconnect();
    } catch {}
    this._onDestroy?.();
  }

  /**
   * Rebuild the chain `input → [filter1 → ... → filterN] → output`. Called
   * after any add/remove of a filter. Disconnects the input's outgoing edges
   * (and each filter's outgoing edges) first, then reapplies the chain.
   * The output node's edges to downstream targets are not touched.
   */
  private _refreshFilters(): void {
    try {
      this.input.disconnect();
    } catch {}
    for (const f of this._filterNodes) {
      try {
        f.disconnect();
      } catch {}
    }
    if (this._filterNodes.length === 0) {
      this.input.connect(this.output);
      return;
    }
    let prev: AudioNode = this.input;
    for (const f of this._filterNodes) {
      prev.connect(f);
      prev = f;
    }
    prev.connect(this.output);
  }

  private _throwIfDestroyed(): void {
    if (this._destroyed) {
      throw new Error(`Bus '${this.name ?? "<anonymous>"}' has been destroyed`);
    }
  }
}
