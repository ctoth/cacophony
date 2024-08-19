export interface BaseAudioEvents {
  play: void;
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

export interface SynthEvents extends BaseAudioEvents {
  frequencyChange: number;
  typeChange: OscillatorType;
}

export interface CacophonyEvents {
  volumeChange: number;
  mute: void;
  unmute: void;
  suspend: void;
  resume: void;
}
