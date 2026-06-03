/**
 * Effect name -> factory/schema registry, the single source of truth for the
 * `--fx` surface. Stage 2 fills FOUR effects: distortion, reverb (FDN),
 * compressor, biquad. The remaining effects land in Stage 3.
 */
import type { Cacophony } from "../cacophony";

/** Coerced value produced by {@link parseKvParams}. */
export type KvValue = string | number;

/** A registered effect: a factory plus the schema used to coerce `k=v` params. */
export interface EffectDef {
  /** Build the effect node from coerced params. */
  factory: (caco: Cacophony, params: Record<string, KvValue>) => unknown;
  /** Param-name -> kind, used by {@link parseKvParams} for coercion/validation. */
  schema: Record<string, "num" | "str">;
}

/**
 * The registry. Stage 2: distortion, reverb (FDN), compressor, biquad.
 *
 * Each factory receives the coerced params object directly; the underlying
 * library coerces string aliases (e.g. distortion `shape: "tanh"`) itself, so
 * the CLI passes those strings straight through (schema kind `"str"`).
 */
export const EFFECT_REGISTRY: Record<string, EffectDef> = {
  distortion: {
    // createDistortion = tanh soft-clip waveshaper preset. `shape` accepts the
    // "hardclip"|"tanh" string alias (coerced to 0|1 in the library's build()).
    factory: (c, o) => c.createDistortion(o),
    schema: { drive: "num", shape: "str", mix: "num", output: "num" },
  },
  reverb: {
    // FDN reverb (createFdnReverb / FdnReverbOptions).
    factory: (c, o) => c.createFdnReverb(o),
    schema: {
      decay: "num",
      decayTime: "num",
      preDelay: "num",
      damping: "num",
      diffusion: "num",
      mix: "num",
    },
  },
  compressor: {
    factory: (c, o) => c.createCompressor(o),
    schema: {
      threshold: "num",
      ratio: "num",
      knee: "num",
      attack: "num",
      release: "num",
      makeup: "num",
    },
  },
  biquad: {
    // createBiquadFilter({ type, frequency, gain, Q }).
    factory: (c, o) => c.createBiquadFilter(o as Parameters<typeof c.createBiquadFilter>[0]),
    schema: { type: "str", frequency: "num", gain: "num", Q: "num" },
  },
};

/**
 * The FDN reverb's option field is `decayTime`, but the plan's CLI grammar and
 * the web playground both expose `decay`. Aliases let one schema accept either.
 */
const PARAM_ALIASES: Record<string, Record<string, string>> = {
  reverb: { decay: "decayTime" },
};

/**
 * Coerce a list of `key=value` tokens against an effect's schema into a typed
 * options object.
 *
 * - `"num"` keys are parsed with `Number`; a NaN throws a clear error.
 * - `"str"` keys are passed through verbatim (the library coerces aliases).
 * - Unknown keys (not in the schema) throw.
 *
 * @param schema - the effect's param schema (from {@link EFFECT_REGISTRY}).
 * @param spec - the param string, e.g. `"decay=2.5,mix=0.6"` (may be empty).
 * @param aliases - optional key aliases (e.g. reverb `decay` -> `decayTime`).
 */
export function parseKvParams(
  schema: EffectDef["schema"],
  spec: string,
  aliases: Record<string, string> = {},
): Record<string, KvValue> {
  const out: Record<string, KvValue> = {};
  const trimmed = spec.trim();
  if (trimmed === "") return out;

  for (const token of trimmed.split(",")) {
    const eq = token.indexOf("=");
    if (eq < 0) {
      throw new Error(`Invalid effect param "${token}" (expected key=value)`);
    }
    const rawKey = token.slice(0, eq).trim();
    const rawVal = token.slice(eq + 1).trim();
    const key = aliases[rawKey] ?? rawKey;

    const kind = schema[key];
    if (kind === undefined) {
      const known = Object.keys(schema).join(", ");
      throw new Error(`Unknown effect param "${rawKey}" (known: ${known})`);
    }

    if (kind === "num") {
      const n = Number(rawVal);
      if (!Number.isFinite(n)) {
        throw new Error(`Invalid value for "${rawKey}": "${rawVal}" (expected a number)`);
      }
      out[key] = n;
    } else {
      out[key] = rawVal;
    }
  }
  return out;
}

/** Resolve the alias map for an effect name (empty if none). */
export function aliasesFor(name: string): Record<string, string> {
  return PARAM_ALIASES[name] ?? {};
}
