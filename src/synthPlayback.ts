import type { BaseSound } from "./cacophony";
import type { BaseContext, GainNode, OscillatorNode } from "./context";
import { FilterManager } from "./filters";
import { OscillatorMixin } from "./oscillatorMixin";
import { PannerMixin } from "./pannerMixin";
import type { Synth } from "./synth";
import { VolumeMixin } from "./volumeMixin";

enum SynthPlaybackState {
  Unplayed,
  Playing,
  Paused,
  Stopped,
}

export class SynthPlayback extends OscillatorMixin(PannerMixin(VolumeMixin(FilterManager))) implements BaseSound {
  context: BaseContext;
  private _state: SynthPlaybackState = SynthPlaybackState.Unplayed;
  constructor(
    public origin: Synth,
    public source: OscillatorNode,
    gainNode: GainNode,
  ) {
    super();
    this.context = origin.context;
    this.setPanType(origin.panType, origin.context);
    this.source.connect(this.panner!);
    this.setGainNode(gainNode);
    this.panner!.connect(this.gainNode!);
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

    if (this._state === SynthPlaybackState.Playing) {
      return [this];
    }

    if (this._state === SynthPlaybackState.Paused || this._state === SynthPlaybackState.Stopped) {
      this.recreateSource();
    }

    if (this.oscillatorOptions.detune !== undefined) this.source.detune.value = this.oscillatorOptions.detune;
    if (this.oscillatorOptions.frequency !== undefined) this.source.frequency.value = this.oscillatorOptions.frequency;
    if (this.oscillatorOptions.type) this.source.type = this.oscillatorOptions.type;

    this.source.start();
    this._playing = true;
    this._state = SynthPlaybackState.Playing;
    return [this];
  }

  pause(): void {
    if (!this.source || this._state !== SynthPlaybackState.Playing) {
      return;
    }

    this.source.stop();
    this._playing = false;
    this._state = SynthPlaybackState.Paused;
  }

  stop(): void {
    if (!this.source || this._state === SynthPlaybackState.Unplayed || this._state === SynthPlaybackState.Stopped) {
      return;
    }

    if (this._state === SynthPlaybackState.Playing) {
      this.source.stop();
    }

    this._playing = false;
    this._state = SynthPlaybackState.Stopped;
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
    let connection = this.panner;
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

  private recreateSource(): void {
    if (!this.panner) {
      throw new Error("Cannot recreate source of a synth that has been cleaned up");
    }

    this.source.disconnect();
    this.source = this.context.createOscillator();
    this.source.connect(this.panner);
  }
}
