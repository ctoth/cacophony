import type { Cacophony, PanType } from "./cacophony";
import type { AudioNode, BaseContext, GainNode } from "./context";
import { MediaStreamPlayback, MediaStreamSound, type MediaStreamSoundOptions } from "./mediaStream";
import type { HrtfPannerOptions } from "./pannerMixin";

/** Options for acquiring and monitoring a microphone stream. */
export interface MicrophoneStreamOptions extends MediaStreamSoundOptions {
  /** Constraints forwarded to `navigator.mediaDevices.getUserMedia`. */
  constraints?: MediaStreamConstraints;
  /**
   * Stop the microphone tracks when playback stops or is cleaned up.
   * Defaults to `true`. Set to `false` to keep the stream reusable.
   */
  stopTracksOnStop?: boolean;
  /** Initial left/right pan when `panType` is `"stereo"`. */
  stereoPan?: number;
  /** Initial spatial options when `panType` is `"HRTF"` (the default). */
  threeDOptions?: Partial<HrtfPannerOptions>;
}

/**
 * A microphone playback uses the same BasePlayback lifecycle, event, panning,
 * effect, routing, and cleanup implementation as every other MediaStream.
 */
export { MediaStreamPlayback as MicrophonePlayback };

/**
 * A live microphone source backed by the current MediaStreamSound architecture.
 * Use {@link MicrophoneStream.request} (or `Cacophony.getMicrophoneStream`) when
 * the stream still needs to be acquired so permission failures remain observable.
 */
export class MicrophoneStream extends MediaStreamSound {
  static async request(
    context: BaseContext,
    outputNode?: AudioNode,
    options: MicrophoneStreamOptions = {},
    cacophony?: Cacophony,
  ): Promise<MicrophoneStream> {
    const stream = await navigator.mediaDevices.getUserMedia(options.constraints ?? { audio: true });
    return new MicrophoneStream(context, stream, outputNode, options, cacophony);
  }

  constructor(
    context: BaseContext,
    stream: MediaStream,
    outputNode?: AudioNode,
    options: MicrophoneStreamOptions = {},
    cacophony?: Cacophony,
  ) {
    const { constraints: _constraints, stereoPan, threeDOptions, ...mediaStreamOptions } = options;
    const panType: PanType = mediaStreamOptions.panType ?? "HRTF";
    super(
      stream,
      context,
      (outputNode ?? context.destination) as GainNode,
      {
        ...mediaStreamOptions,
        panType,
        primeWithMediaElement: mediaStreamOptions.primeWithMediaElement ?? false,
        stopTracksOnStop: mediaStreamOptions.stopTracksOnStop ?? true,
      },
      cacophony,
    );

    if (panType === "stereo") {
      this.stereoPan = stereoPan ?? 0;
    } else if (threeDOptions) {
      this.threeDOptions = threeDOptions;
    }
  }
}
