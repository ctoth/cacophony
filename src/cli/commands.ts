/**
 * The CLI command core: mode-agnostic builders shared by render mode and,
 * later, live mode. Stage 2 adds the FILE source branch to {@link buildSource}
 * and the {@link buildFxBus} effect-chain builder.
 */

import type { OfflineAudioContext } from "node-web-audio-api";
import type { Bus } from "../bus";
import type { Cacophony, LoopCount } from "../cacophony";
import { decodeAudioFile } from "../node";
import type { Sound } from "../sound";
import type { Synth } from "../synth";
import { aliasesFor, EFFECT_REGISTRY, parseKvParams } from "./effects-registry";

/** Waveforms accepted by the `synth:<freq>[:<wave>]` source grammar. */
const SYNTH_WAVES = ["sine", "sawtooth", "square", "triangle"] as const;
type SynthWave = (typeof SYNTH_WAVES)[number];

/** Options applied to a built source. */
export interface BuildSourceOptions {
  /** Linear gain in [0, 1]. */
  volume?: number;
  /** Loop count, or `"infinite"`. */
  loop?: LoopCount;
}

/** A built source the runner can start and route. */
export interface SourceHandle {
  /** Start the source playing into the (offline) graph. */
  play(): void;
  /** The underlying Sound or Synth, for routing onto an fx bus. */
  source: Sound | Synth;
}

function isSynthWave(value: string): value is SynthWave {
  return (SYNTH_WAVES as readonly string[]).includes(value);
}

/**
 * Parse a `synth:<freq>[:<wave>]` spec into an oscillator config.
 * Throws on malformed specs (bad number, unknown waveform).
 */
function parseSynthSpec(spec: string): { frequency: number; type: SynthWave } {
  const parts = spec.split(":");
  // parts[0] === "synth"
  const freqToken = parts[1];
  const waveToken = parts[2];

  const frequency = Number(freqToken);
  if (!freqToken || !Number.isFinite(frequency) || frequency <= 0) {
    throw new Error(`Invalid synth frequency in "${spec}" (expected synth:<freq>[:<wave>])`);
  }

  let type: SynthWave = "sine";
  if (waveToken !== undefined) {
    if (!isSynthWave(waveToken)) {
      throw new Error(`Invalid synth waveform "${waveToken}" (expected one of ${SYNTH_WAVES.join("|")})`);
    }
    type = waveToken;
  }

  return { frequency, type };
}

/**
 * Build a source from a CLI spec. `synth:<freq>[:<wave>]` builds an oscillator;
 * any other spec is treated as a file PATH (decoded via `decodeAudioFile`).
 *
 * The `"stereo"` pan type is used for both branches so the offline render is
 * deterministic (HRTF panning is non-trivial and not needed for render A/B).
 *
 * @param caco - the Cacophony instance (offline or live).
 * @param ctx - the backing context (used by file sources to decode).
 * @param spec - the source spec string (synth spec or file path).
 * @param options - per-source options (volume, loop, ...).
 */
export async function buildSource(
  caco: Cacophony,
  ctx: OfflineAudioContext,
  spec: string,
  options: BuildSourceOptions = {},
): Promise<SourceHandle> {
  if (spec.startsWith("synth:")) {
    const { frequency, type } = parseSynthSpec(spec);
    const synth: Synth = await caco.createOscillator({ frequency, type }, "stereo");
    if (options.volume !== undefined) {
      synth.volume = options.volume;
    }
    if (options.loop !== undefined) {
      throw new Error("--loop is only valid for file sources, not synths");
    }
    return {
      play: () => synth.play(),
      source: synth,
    };
  }

  // File source: decode from disk, then create a buffer-backed Sound.
  const buffer = await decodeAudioFile(ctx as unknown as Parameters<typeof decodeAudioFile>[0], spec);
  const sound: Sound = await caco.createSound(buffer, "buffer", "stereo");
  if (options.volume !== undefined) {
    sound.volume = options.volume;
  }
  if (options.loop !== undefined) {
    sound.loop(options.loop);
  }
  return {
    play: () => sound.play(),
    source: sound,
  };
}

/** One parsed `--fx name[:k=v,...]` token. */
export interface FxSpec {
  /** Effect name (a key of {@link EFFECT_REGISTRY}). */
  name: string;
  /** The raw `k=v,k=v` param string (may be empty). */
  params: string;
}

/** Result of {@link buildFxBus}: the bus plus the effect nodes added to it. */
export interface FxBus {
  bus: Bus;
  nodes: unknown[];
}

/**
 * Split a single `--fx` token into `{ name, params }`. The name is everything
 * before the first `:`; the params are everything after (so `=` and `,` inside
 * the params survive untouched, per Risk R6).
 */
export function parseFxToken(token: string): FxSpec {
  const colon = token.indexOf(":");
  if (colon < 0) {
    return { name: token.trim(), params: "" };
  }
  return { name: token.slice(0, colon).trim(), params: token.slice(colon + 1) };
}

/**
 * Build an anonymous fx bus and add each effect in argument order.
 *
 * @param caco - the Cacophony instance.
 * @param fxSpecs - parsed fx tokens, applied in order (chained on the bus).
 * @returns the created bus and the built effect nodes.
 */
export async function buildFxBus(caco: Cacophony, fxSpecs: readonly FxSpec[]): Promise<FxBus> {
  const bus = caco.createBus();
  const nodes: unknown[] = [];
  for (const spec of fxSpecs) {
    const def = EFFECT_REGISTRY[spec.name];
    if (!def) {
      const known = Object.keys(EFFECT_REGISTRY).join(", ");
      throw new Error(`Unknown effect "${spec.name}" (known: ${known})`);
    }
    const opts = parseKvParams(def.schema, spec.params, aliasesFor(spec.name));
    const node = await bus.addFilter(def.factory(caco, opts) as Parameters<typeof bus.addFilter>[0]);
    nodes.push(node);
  }
  return { bus, nodes };
}
