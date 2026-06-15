/**
 * Resolve the output sink for the realtime CLI (`play` / `synth` / `repl`).
 *
 * Set `CACOPHONY_SINK=none` to select a null sink in environments with no audio
 * device (CI, containers), where constructing a real-time `AudioContext` against
 * the default device crashes with `DeviceNotAvailable`. Unset (the default)
 * uses the system default output device so playback is audible.
 */
export function cliSinkId(): { type: "none" } | undefined {
  return process.env.CACOPHONY_SINK === "none" ? { type: "none" } : undefined;
}
