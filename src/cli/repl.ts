/**
 * Interactive REPL: holds ONE live `createNodeCacophony()` graph plus a
 * {@link Session}, reads lines with `node:readline/promises`, and dispatches
 * each line to the SAME command core (`buildSource`, `buildFxBus`,
 * `EFFECT_REGISTRY`, `parseKvParams`) used by render and one-shot live mode.
 *
 * Stage 4 implements the CORE verb set: transport/sources, buses + routing,
 * effects on a bus, and master/session. Out of scope (Stage 5): spatial/`pos`/
 * `foa`, `meter`, `pitch`, `stretch`, `group`, REPL `render`.
 *
 * Exit discipline (the hard rule, `src/node.ts:11-14`): every way out — `exit`,
 * `quit`, EOF (Ctrl-D / closed stdin), and `SIGINT` (Ctrl-C) — funnels through
 * ONE idempotent shutdown that `await context.close()`s, or the real-time
 * context's keep-alive timer hangs the process.
 */
import * as readline from "node:readline/promises";
import type { Bus } from "../bus";
import { createNodeCacophony } from "../node";
import { buildSource } from "./commands";
import { aliasesFor, EFFECT_REGISTRY, parseKvParams } from "./effects-registry";
import { filteringLogger } from "./logging";
import { DEFAULT_FX_BUS, Session } from "./session";

const HELP = `cacophony REPL — live graph. Commands:

transport / sources:
  load <file> [as <name>]          decode + create a buffer sound
  synth <freq> [wave] [as <name>]  create an oscillator (wave: sine|sawtooth|square|triangle)
  play [name]                      play (default: current source)
  pause [name]                     pause
  stop [name] | stop all           stop one / all sources
  vol <0..1> [name]                set source volume
  loop <n|infinite> [name]         loop a sound

buses + routing:
  bus new <name>                   create a named bus
  bus list                         list named buses
  route <name> [send <gain>]       route current source to a bus (send adds a parallel send)
  route master [name]              route a source back to master (dry)

effects on a bus (default bus: "${DEFAULT_FX_BUS}"):
  fx add <effect> [k=v ...] [on <bus>]
  fx list [on <bus>]
  fx remove <idx> [on <bus>]
  fx bypass <idx> on|off [on <bus>]
  param <effect-idx> <name> <value> [over <ms>]   ramp a filter param on a bus

master / session:
  master vol <0..1>                set master volume
  mute | unmute                    mute / unmute everything
  help                             this help
  exit | quit                      close the graph and leave
`;

/** Split a `fx add ... [on <bus>]` token list into (params, busName?). */
function splitOnBus(tokens: string[]): { rest: string[]; bus?: string } {
  const onIdx = tokens.lastIndexOf("on");
  if (onIdx >= 0 && onIdx === tokens.length - 2) {
    return { rest: tokens.slice(0, onIdx), bus: tokens[onIdx + 1] };
  }
  return { rest: tokens };
}

/** Parse a `<n|infinite>` loop token. */
function parseLoop(tok: string): number | "infinite" {
  if (tok === "infinite") return "infinite";
  const n = Number(tok);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`Invalid loop count '${tok}' (expected a non-negative integer or "infinite")`);
  return n;
}

/** Parse a `<0..1>`-ish volume/gain token. */
function parseGain(tok: string, label: string): number {
  const n = Number(tok);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${label} '${tok}' (expected a number >= 0)`);
  return n;
}

/**
 * Run the interactive REPL. Resolves once the graph is torn down and the
 * context closed (i.e. it is safe for the caller to exit 0).
 */
export async function runRepl(): Promise<void> {
  const { cacophony, context } = createNodeCacophony({ logger: filteringLogger });
  const session = new Session(cacophony);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "cacophony> " });
  const out = (s: string): void => void process.stdout.write(`${s}\n`);

  let closed = false;
  const onSigint = () => {
    void shutdown();
  };
  async function shutdown(): Promise<void> {
    if (closed) return;
    closed = true;
    process.off("SIGINT", onSigint);
    rl.close();
    await context.close();
  }
  process.on("SIGINT", onSigint);

  /** Resolve a bus from a trailing `on <bus>` (defaults to scratch fx bus). */
  const busFor = (name?: string): Bus => (name === undefined ? session.scratchBus() : session.resolveBus(name));

  /** Resolve a filter node by index on a bus, with a friendly error. */
  const filterAt = (bus: Bus, idxTok: string): { node: Bus["filters"][number]; idx: number } => {
    const idx = Number(idxTok);
    const filters = bus.filters;
    if (!Number.isInteger(idx) || idx < 0 || idx >= filters.length) {
      throw new Error(`No filter #${idxTok} on bus (it has ${filters.length})`);
    }
    return { node: filters[idx], idx };
  };

  async function dispatch(line: string): Promise<boolean> {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;
    const [cmd, ...args] = tokens;

    switch (cmd) {
      case "help":
        out(HELP);
        return false;

      case "exit":
      case "quit":
        return true;

      case "load": {
        const file = args[0];
        if (!file) throw new Error("load <file> [as <name>]");
        const name = args[1] === "as" ? args[2] : undefined;
        const handle = await buildSource(cacophony, context as unknown as Parameters<typeof buildSource>[1], file);
        const resolved = session.addSource(handle.source, name);
        out(`loaded ${file} as '${resolved}'`);
        return false;
      }

      case "synth": {
        const freq = args[0];
        if (!freq) throw new Error("synth <freq> [wave] [as <name>]");
        // optional wave, optional `as <name>`
        let wave: string | undefined;
        let name: string | undefined;
        const rest = args.slice(1);
        if (rest[0] && rest[0] !== "as") wave = rest.shift();
        if (rest[0] === "as") name = rest[1];
        const spec = wave ? `synth:${freq}:${wave}` : `synth:${freq}`;
        const handle = await buildSource(cacophony, context as unknown as Parameters<typeof buildSource>[1], spec);
        const resolved = session.addSource(handle.source, name);
        out(`synth ${freq}${wave ? ` ${wave}` : ""} as '${resolved}'`);
        return false;
      }

      case "play": {
        session.resolveSource(args[0]).play();
        return false;
      }

      case "pause": {
        session.resolveSource(args[0]).pause();
        return false;
      }

      case "stop": {
        if (args[0] === "all") {
          for (const s of session.allSources()) s.stop();
          return false;
        }
        session.resolveSource(args[0]).stop();
        return false;
      }

      case "vol": {
        const gain = parseGain(args[0], "volume");
        session.resolveSource(args[1]).volume = gain;
        return false;
      }

      case "loop": {
        const count = parseLoop(args[0]);
        const handle = session.resolveSource(args[1]);
        if (!("loop" in handle) || typeof (handle as { loop?: unknown }).loop !== "function") {
          throw new Error("loop is only valid for file sources, not synths");
        }
        (handle as { loop: (c: number | "infinite") => unknown }).loop(count);
        return false;
      }

      case "bus": {
        const sub = args[0];
        if (sub === "new") {
          const name = args[1];
          if (!name) throw new Error("bus new <name>");
          cacophony.createBus(name);
          out(`bus '${name}' created`);
          return false;
        }
        if (sub === "list") {
          out(cacophony.listBuses().join(", ") || "(no named buses)");
          return false;
        }
        throw new Error("bus new <name> | bus list");
      }

      case "route": {
        const target = args[0];
        if (!target) throw new Error("route <bus> [send <gain>] | route master [name]");
        if (target === "master") {
          session.resolveSource(args[1]).routeTo(cacophony.master);
          out("routed to master (dry)");
          return false;
        }
        // route <bus> [send <gain>]
        const bus = session.resolveBus(target);
        const source = session.resolveSource();
        if (args[1] === "send") {
          const gain = parseGain(args[2], "send gain");
          source.routeTo(bus, gain);
          out(`send to '${target}' @ ${gain}`);
        } else {
          source.routeTo(bus);
          out(`routed to '${target}'`);
        }
        return false;
      }

      case "fx": {
        const sub = args[0];
        if (sub === "add") {
          const effect = args[1];
          if (!effect) throw new Error("fx add <effect> [k=v ...] [on <bus>]");
          const def = EFFECT_REGISTRY[effect];
          if (!def) throw new Error(`Unknown effect '${effect}' (known: ${Object.keys(EFFECT_REGISTRY).join(", ")})`);
          const { rest, bus: busName } = splitOnBus(args.slice(2));
          // tokens are space-separated k=v; join with commas for parseKvParams.
          const opts = parseKvParams(def.schema, rest.join(","), aliasesFor(effect));
          const bus = busFor(busName);
          await bus.addFilter(def.factory(cacophony, opts) as Parameters<typeof bus.addFilter>[0]);
          out(`fx add ${effect} on '${busName ?? DEFAULT_FX_BUS}' (#${bus.filters.length - 1})`);
          return false;
        }
        if (sub === "list") {
          const { bus: busName } = splitOnBus(args.slice(1));
          const bus = busFor(busName);
          const lines = bus.filters.map((_, i) => `  #${i}`);
          out(`fx on '${busName ?? DEFAULT_FX_BUS}': ${bus.filters.length}\n${lines.join("\n")}`.trimEnd());
          return false;
        }
        if (sub === "remove") {
          const { rest, bus: busName } = splitOnBus(args.slice(1));
          const bus = busFor(busName);
          const { node } = filterAt(bus, rest[0]);
          bus.removeFilter(node);
          out(`fx removed #${rest[0]} on '${busName ?? DEFAULT_FX_BUS}'`);
          return false;
        }
        if (sub === "bypass") {
          const { rest, bus: busName } = splitOnBus(args.slice(1));
          const idxTok = rest[0];
          const state = rest[1];
          if (state !== "on" && state !== "off") throw new Error("fx bypass <idx> on|off [on <bus>]");
          const bus = busFor(busName);
          const { node } = filterAt(bus, idxTok);
          bus.setFilterBypassed(node, state === "on");
          out(`fx #${idxTok} bypass ${state} on '${busName ?? DEFAULT_FX_BUS}'`);
          return false;
        }
        throw new Error("fx add|list|remove|bypass ...");
      }

      case "param": {
        // param <effect-idx> <name> <value> [over <ms>] [on <bus>]
        const { rest, bus: busName } = splitOnBus(args);
        const [idxTok, paramName, valueTok, overKw, msTok] = rest;
        if (!idxTok || !paramName || valueTok === undefined)
          throw new Error("param <effect-idx> <name> <value> [over <ms>]");
        const value = Number(valueTok);
        if (!Number.isFinite(value)) throw new Error(`Invalid param value '${valueTok}'`);
        const bus = busFor(busName);
        const { node } = filterAt(bus, idxTok);
        let duration: number | undefined;
        if (overKw === "over") {
          const ms = Number(msTok);
          if (!Number.isFinite(ms) || ms < 0) throw new Error(`Invalid ramp duration '${msTok}' ms`);
          duration = ms / 1000;
        }
        bus.rampFilterParam(node, paramName, value, duration !== undefined ? { duration } : undefined);
        out(`param #${idxTok} ${paramName} -> ${value}${duration !== undefined ? ` over ${msTok}ms` : ""}`);
        return false;
      }

      case "master": {
        if (args[0] !== "vol") throw new Error("master vol <0..1>");
        cacophony.volume = parseGain(args[1], "master volume");
        out(`master vol ${cacophony.volume}`);
        return false;
      }

      case "mute":
        cacophony.mute();
        out("muted");
        return false;

      case "unmute":
        cacophony.unmute();
        out("unmuted");
        return false;

      default:
        out(`Unknown command: ${cmd} (try 'help')`);
        return false;
    }
  }

  rl.prompt();
  try {
    for await (const line of rl) {
      let shouldExit = false;
      try {
        shouldExit = await dispatch(line);
      } catch (err) {
        out(`error: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (shouldExit) break;
      if (!closed) rl.prompt();
    }
  } finally {
    await shutdown();
  }
}
