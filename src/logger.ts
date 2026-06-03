/**
 * Minimal logging seam used by Cacophony for host-side (main-thread) diagnostic
 * output. Injecting a logger via {@link RuntimeOptions.logger} — or silencing
 * all output via {@link RuntimeOptions.quiet} — lets embedders (notably Node /
 * headless / CLI hosts) capture or suppress the `[cacophony/worklet]` chatter
 * without monkey-patching `console`.
 */
export interface CacophonyLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Default logger: forwards each level to the corresponding `console` method.
 *
 * The methods dispatch through `console.*` dynamically (rather than binding the
 * reference once) so that test spies installed on `console.info` / `console.warn`
 * / `console.error` after this object is created are still observed.
 */
export const consoleLogger: CacophonyLogger = {
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

/** No-op logger: discards all output. Used when `quiet` is set. */
export const noopLogger: CacophonyLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
