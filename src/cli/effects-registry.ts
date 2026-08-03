/**
 * Effect name -> factory/schema registry, the single source of truth for the
 * `--fx` surface. Stage 2 filled FOUR effects: distortion, reverb (FDN),
 * compressor, biquad. Stage 3 completes the suite: dattorro, waveshaper,
 * limiter, gate, the modulated-delay family (chorus/flanger/vibrato/doubling/
 * delay), phaser, tremolo, autopan, and the advanced paper-backed suite:
 * frequencyShifter, barberpole, harmonizer, spectralFreeze, stereoWidener.
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
 * The five modulated-delay presets (chorus/flanger/vibrato/doubling/delay) all
 * share one worklet and one option schema; only the Cacophony factory differs.
 * Build their registry entries from a single shared schema to avoid drift.
 */
function modulatedDelayEntries(): Record<string, EffectDef> {
  const schema: EffectDef["schema"] = {
    delayTime: "num",
    depth: "num",
    rate: "num",
    feedback: "num",
    blend: "num",
    feedforward: "num",
    interpolation: "str",
  };
  return {
    chorus: { factory: (c, o) => c.createChorus(o), schema },
    flanger: { factory: (c, o) => c.createFlanger(o), schema },
    vibrato: { factory: (c, o) => c.createVibrato(o), schema },
    doubling: { factory: (c, o) => c.createDoubling(o), schema },
    delay: { factory: (c, o) => c.createDelay(o), schema },
  };
}

/**
 * The registry. Stage 2: distortion, reverb (FDN), compressor, biquad. Stage 3
 * adds the rest of the suite (see below).
 *
 * Each factory receives the coerced params object directly; the underlying
 * library coerces string aliases (e.g. distortion `shape: "tanh"`, modulated-
 * delay `interpolation: "cubic"`) itself, so the CLI passes those strings
 * straight through (schema kind `"str"`).
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

  // --- Stage 3 ---

  dattorro: {
    // Dattorro plate reverb (createReverb / ReverbOptions). NOTE: dattorro's
    // own `decay` key is passed straight through — it is NOT aliased the way the
    // FDN `reverb` aliases `decay`->`decayTime` (these are distinct effects).
    factory: (c, o) => c.createReverb(o),
    schema: {
      preDelay: "num",
      bandwidth: "num",
      inputDiffusion1: "num",
      inputDiffusion2: "num",
      decay: "num",
      decayDiffusion1: "num",
      decayDiffusion2: "num",
      damping: "num",
      excursionRate: "num",
      excursionDepth: "num",
      wet: "num",
      dry: "num",
    },
  },
  waveshaper: {
    // Antialiased waveshaper (createWaveshaper / WaveshaperOptions). `shape`
    // accepts the "hardclip"|"tanh" string alias (coerced in build()).
    factory: (c, o) => c.createWaveshaper(o),
    schema: { drive: "num", shape: "str", mix: "num", output: "num" },
  },
  limiter: {
    // createLimiter = Dynamics preset with NO ratio (Omit<DynamicsOptions,
    // "ratio">, cacophony.d.ts:583) — ratio is intentionally absent here.
    factory: (c, o) => c.createLimiter(o),
    schema: {
      threshold: "num",
      knee: "num",
      attack: "num",
      release: "num",
      makeup: "num",
    },
  },
  gate: {
    // createGate = Dynamics preset (full DynamicsOptions, including ratio).
    factory: (c, o) => c.createGate(o),
    schema: {
      threshold: "num",
      ratio: "num",
      knee: "num",
      attack: "num",
      release: "num",
      makeup: "num",
    },
  },

  // Modulated-delay family: chorus/flanger/vibrato/doubling/delay all share the
  // ModulatedDelayOptions schema (one worklet, factory presets). `interpolation`
  // accepts the "cubic"|"linear" string alias (coerced in build()).
  ...modulatedDelayEntries(),

  phaser: {
    factory: (c, o) => c.createPhaser(o),
    schema: {
      frequency: "num",
      rate: "num",
      depth: "num",
      stages: "num",
      feedback: "num",
      mix: "num",
    },
  },
  tremolo: {
    // `shape` accepts the "sine"|"triangle"|"square" string alias.
    factory: (c, o) => c.createTremolo(o),
    schema: { rate: "num", depth: "num", shape: "str", stereoPhase: "num" },
  },
  autopan: {
    // createAutoPan shares TremoloOptions (a stereoPhase=180 tremolo preset).
    factory: (c, o) => c.createAutoPan(o),
    schema: { rate: "num", depth: "num", shape: "str", stereoPhase: "num" },
  },
  frequencyShifter: {
    factory: (c, o) => c.createFrequencyShifter(o),
    schema: { frequency: "num", mix: "num" },
  },
  barberpole: {
    factory: (c, o) => c.createBarberpole(o),
    schema: { rate: "num", stages: "num", coefficient: "num", mix: "num" },
  },
  harmonizer: {
    factory: (c, o) => c.createHarmonizer(o),
    schema: { semitonesA: "num", semitonesB: "num", gainA: "num", gainB: "num", dry: "num" },
  },
  spectralFreeze: {
    factory: (c, o) => c.createSpectralFreeze(o),
    schema: { freeze: "num", smear: "num", mix: "num" },
  },
  stereoWidener: {
    factory: (c, o) => c.createStereoWidener(o),
    schema: { width: "num", decorrelation: "num", transientProtection: "num" },
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
