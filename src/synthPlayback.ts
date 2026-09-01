import type { BaseSound, PlayOptions } from "./cacophony";
import type { AudioNode, AudioParam, BaseContext, GainNode, OscillatorNode } from "./context";
import { OscillatorMixin } from "./oscillatorMixin";
import type { Synth } from "./synth";

export class SynthPlayback extends OscillatorMixin implements BaseSound {
  context: BaseContext;
  /**
   * Live oscillator node. Set in the constructor; cleared to `undefined` in
   * {@link cleanup} (matches Playback's `source?` shape so post-cleanup
   * checks of `!this.source` work uniformly).
   */
  public declare source?: OscillatorNode;
  constructor(
    public origin: Synth,
    source: OscillatorNode,
    gainNode: GainNode,
  ) {
    super(origin);
    this.context = origin.context;
    this.source = source;
    this.setPanType(origin.panType, origin.context);
    // setPanType synchronously assigns this.panner; capture locally so TS
    // narrows to non-undefined for the connect calls below.
    const panner = this.panner;
    if (!panner) {
      throw new Error("setPanType did not produce a panner node");
    }
    this.setGainNode(gainNode);
    this.setEffectChainEndpoints(source, panner);
    panner.connect(gainNode);
    this.oscillatorOptions = {
      detune: source.detune.value,
      frequency: source.frequency.value,
      type: source.type,
    };
  }

  play(options?: PlayOptions): [this] {
    if (options?.at !== undefined) {
      throw new Error("Scheduled playback is not supported for synths");
    }
    if (!this.source || !this.panner) {
      throw new Error("Cannot play a synth that has been cleaned up");
    }

    if (this._state === "playing") {
      return [this];
    }

    const isResume = this._state === "paused";
    if (isResume || this._state === "stopped") {
      this.recreateSource();
    }

    if (this.oscillatorOptions.detune !== undefined) this.source.detune.value = this.oscillatorOptions.detune;
    if (this.oscillatorOptions.frequency !== undefined) this.source.frequency.value = this.oscillatorOptions.frequency;
    if (this.oscillatorOptions.type) this.source.type = this.oscillatorOptions.type;

    this.source.start();
    this.emitPlayStarted(isResume);
    return [this];
  }

  pause(): void {
    if (!this.source || this._state !== "playing") {
      return;
    }

    this.source.stop();
    this.emitPaused();
  }

  stop(): void {
    if (!this.source || this._state === "unplayed" || this._state === "stopped") {
      return;
    }

    if (this._state === "playing") {
      this.source.stop();
    }

    this.emitStopped();
  }

  cleanup(): void {
    if (!this.source) {
      // Already cleaned up — same idempotency guard as Playback.cleanup.
      return;
    }
    if (this.panner && this.gainNode) {
      try {
        this.panner.disconnect();
      } catch {}
    }
    this.source = undefined;
    this.panner = undefined;
    this.markStopped();
    this.eventEmitter.removeAllListeners();
    // super.cleanup() (VolumeMixin) disconnects + clears `gainNode`; after
    // this call `outputNode` throws (parity with Playback.cleanup).
    super.cleanup();
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
   * Connects this synth playback's output to an AudioNode or AudioParam. Mirrors
   * Playback.connect.
   *
   * @returns The destination node (for chaining).
   * @throws if the playback has been cleaned up.
   */
  connect(destination: AudioNode | AudioParam): AudioNode {
    return this.outputNode.connect(destination as any);
  }

  /**
   * Disconnects this synth playback's output from a specific destination
   * or from all destinations. Mirrors Playback.disconnect.
   *
   * @throws if the playback has been cleaned up.
   */
  disconnect(destination?: AudioNode | AudioParam): void {
    if (destination) {
      this.outputNode.disconnect(destination as any);
    } else {
      this.outputNode.disconnect();
    }
  }

  private recreateSource(): void {
    if (!this.panner || !this.source) {
      throw new Error("Cannot recreate source of a synth that has been cleaned up");
    }

    this.source.disconnect();
    this.source = this.context.createOscillator();
    this.setEffectChainEndpoints(this.source, this.panner);
  }
}
