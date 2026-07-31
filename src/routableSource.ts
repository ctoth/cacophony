import type { BasePlayback } from "./basePlayback";
import type { Bus, BusRoutedSource } from "./bus";
import type { Cacophony } from "./cacophony";
import { PlaybackContainer } from "./container";
import type { BaseContext, BiquadFilterNode, GainNode } from "./context";
import type { CacophonyEffect } from "./effects";
import { BiquadRecipeEffect } from "./effects";
import { FilterManager } from "./filters";

/**
 * Shared routing state machine for playback-producing sources.
 *
 * The concrete source supplies its audio context, master output, owning
 * Cacophony instance, and playback list. This mixin owns primary-route state,
 * additive sends, bus registration, live rewiring, drain handling, and route
 * cleanup for every source type.
 */
export abstract class RoutableSource extends PlaybackContainer(FilterManager) implements BusRoutedSource {
  protected abstract context: BaseContext;
  protected abstract globalGainNode: GainNode;
  abstract get cacophony(): Cacophony | undefined;

  /** Primary route target. `null` is the canonical master route. */
  protected _routeTarget: Bus | null = null;
  /** Additional send target to gain-value mappings. */
  protected _sends: Map<Bus, number> = new Map();
  /** Effect recipes materialized independently for each future playback. */
  private readonly _effects: CacophonyEffect[] = [];
  private readonly _filterEffects = new Map<BiquadFilterNode, CacophonyEffect>();
  private readonly _filterEffectRecipes = new Set<CacophonyEffect>();

  addEffect(effect: CacophonyEffect): void {
    if (this._effects.includes(effect)) {
      throw new Error("Cannot add the same effect recipe twice");
    }
    this._effects.push(effect);
  }

  removeEffect(effect: CacophonyEffect): void {
    const index = this._effects.indexOf(effect);
    if (index === -1) {
      throw new Error("Cannot remove an effect recipe that was never added");
    }
    this._effects.splice(index, 1);
  }

  override addFilter(filter: BiquadFilterNode): void {
    super.addFilter(filter);
    const effect = new BiquadRecipeEffect(filter);
    this._filterEffects.set(filter, effect);
    this._filterEffectRecipes.add(effect);
    this._effects.push(effect);
  }

  override removeFilter(filter: BiquadFilterNode): void {
    super.removeFilter(filter);
    const effect = this._filterEffects.get(filter);
    if (effect) {
      this._effects.splice(this._effects.indexOf(effect), 1);
      this._filterEffects.delete(filter);
      this._filterEffectRecipes.delete(effect);
    }
  }

  /**
   * Route this source to a bus, or add an independent send when `sendGain`
   * is provided.
   */
  routeTo(target: Bus | string, sendGain?: number): void {
    const bus = this._resolveBusArg(target);
    if (sendGain !== undefined) {
      this._addSend(bus, sendGain);
      return;
    }
    this._setPrimary(bus);
  }

  private _resolveBusArg(target: Bus | string): Bus {
    if (typeof target !== "string") {
      return target;
    }
    const bus = this.cacophony?.getBus(target);
    if (!bus) {
      throw new Error(`No bus registered with name '${target}'`);
    }
    return bus;
  }

  /**
   * Resolve the node used by future playbacks for their primary output.
   * Sources left on a subsequently destroyed bus fall back to master.
   */
  _resolveRouteTargetNode(): GainNode {
    if (!this._routeTarget) {
      return this.globalGainNode;
    }
    if (this._routeTarget.destroyed) {
      console.warn(
        `${this.constructor.name} routed to destroyed bus '${this._routeTarget.name ?? "<anonymous>"}'; falling back to master`,
      );
      return this.globalGainNode;
    }
    return this._routeTarget.input;
  }

  /**
   * Establish every configured send on a newly created playback.
   */
  protected _wireRouteSends(playback: BasePlayback): void {
    const outputNode = (playback as BasePlayback & { readonly outputNode: GainNode }).outputNode;
    for (const [bus, gainValue] of this._sends) {
      if (bus.destroyed) {
        console.warn(`${this.constructor.name} has a send to destroyed bus '${bus.name ?? "<anonymous>"}'; skipping`);
        continue;
      }
      const sendGain = this.context.createGain();
      sendGain.gain.value = gainValue;
      outputNode.connect(sendGain);
      sendGain.connect(bus.input);
      playback._sendGains.set(bus, sendGain);
    }
  }

  /** Materialize all declared recipes, then establish this playback's sends. */
  protected _preparePlayback(playback: BasePlayback): void {
    for (const effect of this._effects) {
      const build = this._filterEffectRecipes.has(effect)
        ? playback._addFilterEffect(effect)
        : playback._addSourceEffect(effect);
      void build.catch((error) => {
        console.warn(`${this.constructor.name} could not build a per-playback effect; continuing without it.`, error);
      });
    }
    this._wireRouteSends(playback);
  }

  private _setPrimary(bus: Bus): void {
    if (bus.destroyed) {
      throw new Error(`Cannot route to destroyed bus '${bus.name ?? "<anonymous>"}'`);
    }
    const collapseToMaster = bus.input === this.globalGainNode;
    const oldTarget = this._routeTarget;
    const oldTargetNode = this._resolveRouteTargetNode();
    this._routeTarget = collapseToMaster ? null : bus;
    const newTarget = this._routeTarget;
    const newTargetNode = this._resolveRouteTargetNode();

    // Bus registration follows bus identity, not resolved node identity. A
    // destroyed bus and master can resolve to the same node while still
    // requiring the old bus registration to be removed.
    if (oldTarget !== newTarget) {
      if (oldTarget && !this._sends.has(oldTarget)) {
        oldTarget._unregisterRoutedSource(this);
      }
      if (newTarget) {
        newTarget._registerRoutedSource(this);
      }
    }
    if (oldTargetNode === newTargetNode) {
      return;
    }
    for (const playback of this.playbacks as Array<BasePlayback & { readonly outputNode: GainNode }>) {
      try {
        playback.outputNode.disconnect(oldTargetNode);
      } catch {
        // A playback may already have been disconnected during cleanup.
      }
      try {
        playback.outputNode.connect(newTargetNode);
      } catch {
        // Live rewiring is best-effort for externally disconnected nodes.
      }
    }
  }

  private _addSend(bus: Bus, gainValue: number): void {
    if (bus.destroyed) {
      throw new Error(`Cannot add a send to destroyed bus '${bus.name ?? "<anonymous>"}'`);
    }
    this._sends.set(bus, gainValue);
    bus._registerRoutedSource(this);
    for (const playback of this.playbacks as Array<BasePlayback & { readonly outputNode: GainNode }>) {
      const existing = playback._sendGains.get(bus);
      if (existing) {
        existing.gain.value = gainValue;
        continue;
      }
      const sendGain = this.context.createGain();
      sendGain.gain.value = gainValue;
      try {
        playback.outputNode.connect(sendGain);
      } catch {
        continue;
      }
      sendGain.connect(bus.input);
      playback._sendGains.set(bus, sendGain);
    }
  }

  _onBusDrained(bus: Bus, target: Bus): void {
    if (this._routeTarget === bus) {
      this._setPrimary(target);
    }
    if (!this._sends.has(bus)) {
      return;
    }
    const gainValue = this._sends.get(bus) as number;
    this._sends.delete(bus);
    for (const playback of this.playbacks as Array<BasePlayback & { readonly outputNode: GainNode }>) {
      const sendGain = playback._sendGains.get(bus);
      if (!sendGain) {
        continue;
      }
      try {
        sendGain.disconnect();
      } catch {
        // The node may already have been disconnected externally.
      }
      playback._sendGains.delete(bus);
    }
    this._addSend(target, gainValue);
  }

  cleanup(): void {
    if (this._routeTarget) {
      this._routeTarget._unregisterRoutedSource(this);
    }
    for (const bus of this._sends.keys()) {
      bus._unregisterRoutedSource(this);
    }
    this._effects.length = 0;
    this._filterEffects.clear();
    this._filterEffectRecipes.clear();
    super.cleanup();
  }
}
