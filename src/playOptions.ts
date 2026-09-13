import type { BasePlayback } from "./basePlayback";
import type { PanType, PlayOptions } from "./cacophony";
import type { BaseContext } from "./context";

type PlaybackKind = "buffer" | "media" | "synth" | "stream";

function finite(name: string, value: number | undefined, min = -Infinity, max = Infinity): void {
  if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) {
    throw new RangeError(`${name} must be finite and between ${min} and ${max}`);
  }
}

function choice(name: string, value: unknown, values: readonly string[]): void {
  if (value !== undefined && !values.includes(value as string)) throw new RangeError(`Invalid ${name}`);
}

/** Validate without allocating nodes or changing a source, voice, or group cursor. */
export function validatePlayOptions(options: PlayOptions | undefined, inheritedPan: PanType, kind: PlaybackKind): void {
  if (!options) return;
  const pan = options.panType ?? inheritedPan;
  choice("panType", options.panType, ["stereo", "HRTF"]);
  finite("volume", options.volume, 0);
  finite("playbackRate", options.playbackRate, Number.MIN_VALUE);
  if (
    options.loopCount !== undefined &&
    options.loopCount !== "infinite" &&
    (!Number.isSafeInteger(options.loopCount) || options.loopCount < 0)
  ) {
    throw new RangeError("loopCount must be a nonnegative integer or infinite");
  }
  finite("at", options.at, 0);
  finite("fadeIn", options.fadeIn, 0);
  finite("fadeOut", options.fadeOut, 0);
  choice("fadeType", options.fadeType, ["linear", "exponential"]);
  if (options.at !== undefined && kind !== "buffer") {
    throw new Error(
      kind === "synth"
        ? "Scheduled playback is not supported for synths"
        : "Scheduled playback is only supported for buffer sounds",
    );
  }
  if (kind === "synth" || kind === "stream") {
    for (const key of ["playbackRate", "loopCount", "fadeOut", "fadeInPerLoop"] as const) {
      if (options[key] !== undefined) throw new Error(`${key} is not supported for ${kind}s`);
    }
  }
  if (options.stereoPan !== undefined && pan !== "stereo")
    throw new Error("Stereo panning is not available when using HRTF.");
  if ((options.position !== undefined || options.threeDOptions !== undefined) && pan !== "HRTF") {
    throw new Error("Position and threeDOptions require HRTF panning");
  }
  finite("stereoPan", options.stereoPan, -1, 1);
  if (options.position !== undefined && (options.position.length !== 3 || !options.position.every(Number.isFinite))) {
    throw new RangeError("position must contain three finite coordinates");
  }
  const spatial = options.threeDOptions;
  if (!spatial) return;
  if ("panType" in spatial && spatial.panType !== "HRTF")
    throw new Error("Cannot apply stereo ThreeDOptions to an HRTF panner");
  if (
    "position" in spatial &&
    spatial.position !== undefined &&
    (spatial.position.length !== 3 || !spatial.position.every(Number.isFinite))
  ) {
    throw new RangeError("position must contain three finite coordinates");
  }
  for (const key of ["positionX", "positionY", "positionZ", "orientationX", "orientationY", "orientationZ"] as const)
    finite(key, spatial[key]);
  for (const key of ["coneInnerAngle", "coneOuterAngle", "refDistance", "rolloffFactor"] as const)
    finite(key, spatial[key], 0);
  finite("maxDistance", spatial.maxDistance, Number.MIN_VALUE);
  finite("coneOuterGain", spatial.coneOuterGain, 0, 1);
  finite("channelCount", spatial.channelCount, 1, 2);
  if (spatial.channelCount !== undefined && !Number.isInteger(spatial.channelCount))
    throw new RangeError("Invalid channelCount");
  choice("distanceModel", spatial.distanceModel, ["linear", "inverse", "exponential"]);
  choice("panningModel", spatial.panningModel, ["equalpower", "HRTF"]);
  choice("channelCountMode", spatial.channelCountMode, ["clamped-max", "explicit"]);
  choice("channelInterpretation", spatial.channelInterpretation, ["speakers", "discrete"]);
}

/** Apply common settings before activating the source. */
export function applyPlayOptions(voice: BasePlayback, context: BaseContext, options?: PlayOptions): void {
  if (!options) return;
  if (options.panType !== undefined) voice.setPanType(options.panType, context);
  if (options.volume !== undefined) voice.volume = options.volume;
  if (options.threeDOptions !== undefined) {
    voice.threeDOptions = options.threeDOptions;
    if ("position" in options.threeDOptions && options.threeDOptions.position !== undefined) {
      voice.position = options.threeDOptions.position;
    }
  }
  if (options.position !== undefined) voice.position = options.position;
  if (options.stereoPan !== undefined) voice.stereoPan = options.stereoPan;
}
