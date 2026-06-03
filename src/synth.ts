import type { Bus, BusRoutedSource } from "./bus";
import type { BaseSound, Cacophony, PanType, SoundType } from "./cacophony";
import { PlaybackContainer } from "./container";
import type { BaseContext, GainNode, OscillatorNode } from "./context";
import { TypedEventEmitter } from "./eventEmitter";
import type { SynthEvents } from "./events";
import type { FilterCloneOverrides } from "./filters";
import { FilterManager } from "./filters";
import type { OscillatorCloneOverrides } from "./oscillatorMixin";
import type { PanCloneOverrides } from "./pannerMixin";
import { SynthPlayback } from "./synthPlayback";
import type { VolumeCloneOverrides } from "./volumeMixin";

type SynthCloneOverrides = FilterCloneOverrides & OscillatorCloneOverrides & PanCloneOverrides & VolumeCloneOverrides;

export class Synth extends PlaybackContainer(FilterManager) implements BaseSound, BusRoutedSource {
  _oscillatorOptions: Partial<OscillatorOptions>;
  playbacks: SynthPlayback[] = [];
  private eventEmitter: TypedEventEmitter<SynthEvents> = new TypedEventEmitter<SynthEvents>();
  /** Primary route target. `null` means master. See Sound for full notes. */
  private _routeTarget: Bus | null = null;
  /** Send target → send gain value. See Sound._sends for notes. */
  private _sends: Map<Bus, number> = new Map();

  /**
   * Register event listener.
   * @returns Cleanup function
   */
  on<K extends keyof SynthEvents>(event: K, listener: (data: SynthEvents[K]) => void): () => void {
    return this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener.
   */
  off<K extends keyof SynthEvents>(event: K, listener: (data: SynthEvents[K]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  protected emit<K extends keyof SynthEvents>(event: K, data: SynthEvents[K]): void {
    this.eventEmitter.emit(event, data);
  }

  protected async emitAsync<K extends keyof SynthEvents>(event: K, data: SynthEvents[K]): Promise<void> {
    return this.eventEmitter.emitAsync(event, data);
  }

  constructor(
    public context: BaseContext,
    private globalGainNode: GainNode,
    public soundType: SoundType = "oscillator",
    public panType: PanType = "HRTF",
    oscillatorOptions: Partial<OscillatorOptions> = {},
    private cacophony?: Cacophony,
  ) {
    super();
    this.context = context;
    this._oscillatorOptions = oscillatorOptions;
  }

  /**
   * Clones the current Synth instance, creating a deep copy with the option to override specific properties.
   * This method allows for the creation of a new, independent Synth instance based on the current one, with the
   * flexibility to modify certain attributes through the `overrides` parameter. This is particularly useful for
   * creating variations of a synth without affecting the original instance. The cloned instance includes all properties,
   * playback settings, and filters of the original, unless explicitly overridden.
   *
   * @param {SynthCloneOverrides} overrides - An object specifying properties to override in the cloned instance.
   *        This can include audio settings like volume, playback rate, and spatial positioning, as well as
   *        more complex configurations like 3D audio options and filter adjustments.
   */
  clone(overrides: Partial<SynthCloneOverrides> = {}): Synth {
    const panType = overrides.panType ?? this.panType;
    const stereoPan = overrides.stereoPan !== undefined ? overrides.stereoPan : this.stereoPan;
    const volume = overrides.volume !== undefined ? overrides.volume : this.volume;
    const position = overrides.position?.length ? overrides.position : this.position;
    const filters = overrides.filters?.length ? overrides.filters : this._filters;
    const oscillatorOptions = overrides.oscillatorOptions ?? this._oscillatorOptions;

    const clone = new Synth(
      this.context,
      this.globalGainNode,
      this.soundType,
      panType,
      oscillatorOptions,
      this.cacophony,
    );
    clone._volume = volume;
    clone._position = position;
    clone._stereoPan = stereoPan;
    // Apply HRTF override (if provided) through the canonical setter so the
    // discriminated `_threeDOptions` invariant is preserved. Without an override
    // the new clone keeps its default HRTF storage initialized in the container.
    if (overrides.threeDOptions !== undefined) {
      clone.threeDOptions = overrides.threeDOptions;
    } else if (this.panType === "HRTF") {
      clone.threeDOptions = this.threeDOptions;
    }
    clone.addFilters(filters);
    return clone;
  }

  /**
   * Generates a Playback instance for the synth without starting playback.
   * This allows for pre-configuration of playback properties such as volume and position before the synth is actually played.
   */
  preplay(): SynthPlayback[] {
    const oscillator = this.context.createOscillator();
    const playbacks = this.createPlayback(oscillator);
    return playbacks;
  }

  private createPlayback(oscillator: OscillatorNode): SynthPlayback[] {
    if (this.oscillatorOptions.detune !== undefined) oscillator.detune.value = this.oscillatorOptions.detune;
    if (this.oscillatorOptions.frequency !== undefined) oscillator.frequency.value = this.oscillatorOptions.frequency;
    if (this.oscillatorOptions.type) oscillator.type = this.oscillatorOptions.type;

    const gainNode = this.context.createGain();
    const primaryTargetNode = this._resolveRouteTargetNode();
    gainNode.connect(primaryTargetNode);
    const playback = new SynthPlayback(this, oscillator, gainNode);
    // Establish send edges (per-playback allocation; see Sound docstring).
    // Send-gain GainNodes are owned by the playback (`playback._sendGains`)
    // so cleanup can iterate and disconnect them explicitly.
    if (this._sends.size > 0) {
      for (const [bus, gainValue] of this._sends) {
        if (bus.destroyed) {
          console.warn(`Synth has a send to destroyed bus '${bus.name ?? "<anonymous>"}'; skipping`);
          continue;
        }
        const sendGain = this.context.createGain();
        sendGain.gain.value = gainValue;
        gainNode.connect(sendGain);
        sendGain.connect(bus.input);
        playback._sendGains.set(bus, sendGain);
      }
    }
    playback.volume = this.volume;
    // Clone filters from synth to playback (each playback gets independent filter instances)
    this._filters.forEach((filter) => {
      const clonedFilter = this.context.createBiquadFilter();
      clonedFilter.type = filter.type;
      clonedFilter.frequency.value = filter.frequency.value;
      clonedFilter.Q.value = filter.Q.value;
      clonedFilter.gain.value = filter.gain.value;
      playback.addFilter(clonedFilter);
    });
    if (this.panType === "HRTF") {
      playback.threeDOptions = this.threeDOptions;
      playback.position = this.position;
    } else if (this.panType === "stereo") {
      playback.stereoPan = this.stereoPan;
    }
    this.playbacks.push(playback);
    return [playback];
  }

  play(): ReturnType<this["preplay"]> {
    const playbacks = super.play() as ReturnType<this["preplay"]>;
    this.emit("play", playbacks[0]);
    this.cacophony?.emit("globalPlay", { source: this, timestamp: Date.now() });
    return playbacks;
  }

  stop(): void {
    super.stop();
    this.emit("stop", undefined);
    this.cacophony?.emit("globalStop", { source: this, timestamp: Date.now() });
  }

  pause(): void {
    super.pause();
    this.emit("pause", undefined);
    this.cacophony?.emit("globalPause", { source: this, timestamp: Date.now() });
  }

  resume(): void {
    this.playbacks.forEach((playback) => playback.play());
    this.emit("resume", undefined);
    this.cacophony?.emit("globalPlay", { source: this, timestamp: Date.now() });
  }

  get volume(): number {
    return super.volume;
  }

  set volume(volume: number) {
    super.volume = volume;
    this.emit("volumeChange", volume);
  }

  get oscillatorOptions(): Partial<OscillatorOptions> {
    return this._oscillatorOptions;
  }

  set oscillatorOptions(options: Partial<OscillatorOptions>) {
    this._oscillatorOptions = options;
    this.playbacks.forEach((p) => {
      if (p.source) {
        if (this.oscillatorOptions.detune !== undefined) p.source.detune.value = this.oscillatorOptions.detune;
        if (this.oscillatorOptions.frequency !== undefined) p.source.frequency.value = this.oscillatorOptions.frequency;
        if (this.oscillatorOptions.type) p.source.type = this.oscillatorOptions.type;
      }
    });
  }

  get frequency(): number {
    return (this.oscillatorOptions.frequency as number) ?? 440;
  }

  set frequency(frequency: number) {
    this._oscillatorOptions.frequency = frequency;
    this.playbacks.forEach((p) => (p.frequency = frequency));
    this.emit("frequencyChange", frequency);
  }

  get detune(): number {
    return this.oscillatorOptions.detune as number;
  }

  set detune(detune: number) {
    this._oscillatorOptions.detune = detune;
    this.playbacks.forEach((p) => (p.detune = detune));
    this.emit("detuneChange", detune);
  }

  /**
   * Routes this Synth to a Bus (or back to master). See Sound.routeTo for
   * full semantics — Synth mirrors the behavior exactly.
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

  private _resolveRouteTargetNode(): GainNode {
    if (!this._routeTarget) {
      return this.globalGainNode;
    }
    if (this._routeTarget.destroyed) {
      console.warn(
        `Synth routed to destroyed bus '${this._routeTarget.name ?? "<anonymous>"}'; falling back to master`,
      );
      return this.globalGainNode;
    }
    return this._routeTarget.input;
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
    for (const playback of this.playbacks) {
      try {
        playback.outputNode.disconnect(oldTargetNode);
      } catch {}
      try {
        playback.outputNode.connect(newTargetNode);
      } catch {}
    }
  }

  private _addSend(bus: Bus, gainValue: number): void {
    if (bus.destroyed) {
      throw new Error(`Cannot add a send to destroyed bus '${bus.name ?? "<anonymous>"}'`);
    }
    this._sends.set(bus, gainValue);
    bus._registerRoutedSource(this);
    for (const playback of this.playbacks) {
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
    if (this._sends.has(bus)) {
      const gainValue = this._sends.get(bus) as number;
      this._sends.delete(bus);
      for (const playback of this.playbacks) {
        const sendGain = playback._sendGains.get(bus);
        if (!sendGain) {
          continue;
        }
        try {
          sendGain.disconnect();
        } catch {}
        playback._sendGains.delete(bus);
      }
      this._addSend(target, gainValue);
    }
  }

  get type(): OscillatorType {
    return (this.oscillatorOptions.type as OscillatorType) ?? "sine";
  }

  set type(type: OscillatorType) {
    this._oscillatorOptions.type = type;
    this.playbacks.forEach((p) => (p.type = type));
    this.emit("typeChange", type);
  }
}
