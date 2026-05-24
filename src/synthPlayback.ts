import type { BaseSound } from "./cacophony";
import type { AudioNode, BaseContext, GainNode, OscillatorNode } from "./context";
import { FilterManager } from "./filters";
import { OscillatorMixin } from "./oscillatorMixin";
import { PannerMixin } from "./pannerMixin";
import type { Synth } from "./synth";
import { VolumeMixin } from "./volumeMixin";

type SynthPlaybackState = "unplayed" | "playing" | "paused" | "stopped";

export class SynthPlayback extends OscillatorMixin(PannerMixin(VolumeMixin(FilterManager))) implements BaseSound {
  context: BaseContext;
  private _state: SynthPlaybackState = "unplayed";
  constructor(
    public origin: Synth,
    public source: OscillatorNode,
    gainNode: GainNode,
  ) {
    super(origin);
    this.context = origin.context;
    this.setPanType(origin.panType, origin.context);
    // setPanType synchronously assigns this.panner; capture locally so TS
    // narrows to non-undefined for the connect calls below.
    const panner = this.panner;
    if (!panner) {
      throw new Error("setPanType did not produce a panner node");
    }
    this.source.connect(panner);
    this.setGainNode(gainNode);
    panner.connect(gainNode);
    this.refreshFilters();
    this.oscillatorOptions = {
      detune: source.detune.value,
      frequency: source.frequency.value,
      type: source.type,
    };
  }

  play(): [this] {
    if (!this.source || !this.panner) {
      throw new Error("Cannot play a synth that has been cleaned up");
    }

    if (this._state === "playing") {
      return [this];
    }

    if (this._state === "paused" || this._state === "stopped") {
      this.recreateSource();
    }

    if (this.oscillatorOptions.detune !== undefined) this.source.detune.value = this.oscillatorOptions.detune;
    if (this.oscillatorOptions.frequency !== undefined) this.source.frequency.value = this.oscillatorOptions.frequency;
    if (this.oscillatorOptions.type) this.source.type = this.oscillatorOptions.type;

    this.source.start();
    this._playing = true;
    this._state = "playing";
    return [this];
  }

  pause(): void {
    if (!this.source || this._state !== "playing") {
      return;
    }

    this.source.stop();
    this._playing = false;
    this._state = "paused";
  }

  stop(): void {
    if (!this.source || this._state === "unplayed" || this._state === "stopped") {
      return;
    }

    if (this._state === "playing") {
      this.source.stop();
    }

    this._playing = false;
    this._state = "stopped";
  }

  /**
   * Refreshes the audio filters by re-applying them to the audio signal chain.
   * This method is called internally whenever filters are added or removed.
   * @throws {Error} Throws an error if the synth has been cleaned up.
   */

  private refreshFilters(): void {
    if (!this.panner || !this.gainNode) {
      throw new Error("Cannot update filters on a sound that has been cleaned up");
    }
    let connection: AudioNode = this.panner;
    connection.disconnect();
    connection = this.applyFilters(connection);
    connection.connect(this.gainNode);
  }

  cleanup(): void {
    if (this.panner && this.gainNode) {
      this.source.disconnect(this.panner);
      this.panner.disconnect();
      this.gainNode.disconnect();
    }
    this.eventEmitter.removeAllListeners();
  }

  /**
   * Gets the output node of this synth playback's audio graph — the final
   * GainNode before connection to the destination. Use this to manually
   * wire the playback into custom audio graphs.
   *
   * @throws if the playback has been cleaned up.
   */
  get outputNode(): GainNode {
    if (!this.gainNode) {
      throw new Error("Cannot access output node of a synth playback that has been cleaned up");
    }
    return this.gainNode;
  }

  /**
   * Connects this synth playback's output to an AudioNode. Mirrors
   * Playback.connect.
   *
   * @returns The destination node (for chaining).
   * @throws if the playback has been cleaned up.
   */
  connect(destination: AudioNode): AudioNode {
    return this.outputNode.connect(destination);
  }

  /**
   * Disconnects this synth playback's output from a specific destination
   * or from all destinations. Mirrors Playback.disconnect.
   *
   * @throws if the playback has been cleaned up.
   */
  disconnect(destination?: AudioNode): void {
    if (destination) {
      this.outputNode.disconnect(destination);
    } else {
      this.outputNode.disconnect();
    }
  }

  private recreateSource(): void {
    if (!this.panner) {
      throw new Error("Cannot recreate source of a synth that has been cleaned up");
    }

    this.source.disconnect();
    this.source = this.context.createOscillator();
    this.source.connect(this.panner);
  }
}
