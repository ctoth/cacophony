/**
 * REPL session state: a named-handle registry over the one live Cacophony
 * graph the REPL holds. Maps user-chosen names to sources (sounds/synths) and
 * tracks named buses, plus a "current" source (the last one created) so verbs
 * like `play` / `vol` / `route` can default their target.
 *
 * Buses are looked up via Cacophony's own named-bus registry
 * (`cacophony.getBus` / `createBus(name)`), so this session only needs to
 * remember the scratch fx-bus name and resolve sources.
 */
import type { Bus } from "../bus";
import type { Cacophony } from "../cacophony";
import type { Sound } from "../sound";
import type { Synth } from "../synth";

/** A source handle the session can address by name. */
export type SourceHandle = Sound | Synth;

/** Name of the default scratch fx bus, used when `fx add` omits `on <bus>`. */
export const DEFAULT_FX_BUS = "fx";

/** Tracks named sources and the current default target for the REPL. */
export class Session {
  private readonly sources = new Map<string, SourceHandle>();
  private currentName: string | undefined;
  private anonCounter = 0;

  constructor(private readonly cacophony: Cacophony) {}

  /**
   * Register a source under `name` (or an auto-generated `s<N>` when omitted)
   * and make it the current default target. Returns the resolved name.
   */
  addSource(handle: SourceHandle, name?: string): string {
    const resolved = name ?? `s${++this.anonCounter}`;
    this.sources.set(resolved, handle);
    this.currentName = resolved;
    return resolved;
  }

  /** Names of all registered sources, in insertion order. */
  sourceNames(): string[] {
    return [...this.sources.keys()];
  }

  /**
   * Resolve a source by name, or the current default when `name` is omitted.
   * Throws a friendly error if there is no such source / no current source.
   */
  resolveSource(name?: string): SourceHandle {
    if (name !== undefined) {
      const handle = this.sources.get(name);
      if (!handle) throw new Error(`No source named '${name}' (have: ${this.sourceNames().join(", ") || "none"})`);
      return handle;
    }
    if (this.currentName === undefined) throw new Error("No current source — create one with `load` or `synth` first");
    const handle = this.sources.get(this.currentName);
    if (!handle) throw new Error("Current source is gone — create one with `load` or `synth`");
    return handle;
  }

  /** Every registered source handle (for `stop all`). */
  allSources(): SourceHandle[] {
    return [...this.sources.values()];
  }

  /**
   * Resolve the default scratch fx bus, creating it on first use. Used when an
   * `fx`/`param` command omits an explicit `on <bus>`.
   */
  scratchBus(): Bus {
    return this.cacophony.getBus(DEFAULT_FX_BUS) ?? this.cacophony.createBus(DEFAULT_FX_BUS);
  }

  /** Resolve a named bus, throwing a friendly error if it does not exist. */
  resolveBus(name: string): Bus {
    if (name === DEFAULT_FX_BUS) return this.scratchBus();
    const bus = this.cacophony.getBus(name);
    if (!bus)
      throw new Error(
        `No bus named '${name}' (use \`bus new ${name}\` first; buses: ${this.cacophony.listBuses().join(", ")})`,
      );
    return bus;
  }
}
