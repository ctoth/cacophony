/**
 * Effect name -> factory/schema registry, the single source of truth for the
 * `--fx` surface. Stage 1 ships NO effects (synth + no-fx only); this file is a
 * placeholder filled in from Stage 2 onward.
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
 * The registry. Empty in Stage 1 — populated in Stage 2+ (distortion, reverb,
 * compressor, biquad, ...).
 */
export const EFFECT_REGISTRY: Record<string, EffectDef> = {};

/**
 * Coerce a list of `key=value` tokens against an effect's schema. Stub for
 * Stage 1 (no effects exist yet); the real coercion lands in Stage 2.
 */
export function parseKvParams(_tokens: readonly string[], _schema: EffectDef["schema"]): Record<string, KvValue> {
  throw new Error("parseKvParams is not implemented until CLI Stage 2");
}
