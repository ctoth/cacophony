/**
 * Logging seams for the CLI runners.
 *
 * - Render mode passes `quiet: true` to the offline factory (no host-side
 *   diagnostics at all) — see {@link ../render}.
 * - Live mode (and the REPL) cannot use `quiet` because real warnings/errors
 *   matter while a graph is running. Instead it passes {@link filteringLogger},
 *   which drops only the noisy `[cacophony/worklet]` info lines (which dump the
 *   full base64 `data:` worklet URL on every `addModule`) and forwards
 *   everything else to `console`. Mirrors the manual filter at the top of
 *   `spike/full_api_integration.mjs`.
 */
import type { CacophonyLogger } from "../logger";

/**
 * True when the first arg is a noisy worklet-loader info line. The prefix is
 * `[cacophony/worklet` optionally followed by `:<name>` (e.g.
 * `[cacophony/worklet:waveshaper]`), so match the open prefix, not the exact
 * `[cacophony/worklet]` form.
 */
function isWorkletNoise(args: unknown[]): boolean {
  return typeof args[0] === "string" && args[0].includes("[cacophony/worklet");
}

/**
 * A {@link CacophonyLogger} for live mode: swallows `[cacophony/worklet]` info
 * chatter, forwards real warnings and errors (and any non-worklet info) to
 * `console`.
 */
export const filteringLogger: CacophonyLogger = {
  info: (...args) => {
    if (isWorkletNoise(args)) return;
    console.info(...args);
  },
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
