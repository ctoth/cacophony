import { BasePlayback } from "basePlayback";
import { Playback } from "playback";
import { SynthPlayback } from "./synthPlayback";

export interface BaseAudioEvents {
  play: BasePlayback;
  stop: void;
  pause: void;
  resume: void;
  ended: void;
  volumeChange: number;
}

export interface SoundEvents extends BaseAudioEvents {
  loopEnd: void;
  rateChange: number;
}

export interface PlaybackEvents extends BaseAudioEvents {
  seek: number;
}

export interface SynthEvents extends Omit<BaseAudioEvents, 'play'> {
  play: SynthPlayback;
  frequencyChange: number;
  typeChange: OscillatorType;
  detuneChange: number;
}

export interface CacophonyEvents {
  volumeChange: number;
  mute: void;
  unmute: void;
  suspend: void;
  resume: void;
}
