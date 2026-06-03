/**
 * The CLI command core: mode-agnostic builders shared by render mode (Stage 1)
 * and, later, live mode. Stage 1 implements only the SYNTH branch of
 * {@link buildSource}; file sources land in Stage 2+.
 */

import type { OfflineAudioContext } from "node-web-audio-api";
import type { Cacophony } from "../cacophony";
import type { Synth } from "../synth";

/** Waveforms accepted by the `synth:<freq>[:<wave>]` source grammar. */
const SYNTH_WAVES = ["sine", "sawtooth", "square", "triangle"] as const;
type SynthWave = (typeof SYNTH_WAVES)[number];

/** Options applied to a built source (Stage 1: volume only). */
export interface BuildSourceOptions {
  /** Linear gain in [0, 1]. */
  volume?: number;
}

/** A built source the runner can start. */
export interface SourceHandle {
  /** Start the source playing into the (offline) graph. */
  play(): void;
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
 * Build a source from a CLI spec. Stage 1 handles only `synth:<freq>[:<wave>]`;
 * file-path sources are a later stage and throw for now.
 *
 * @param caco - the Cacophony instance (offline or live).
 * @param _ctx - the backing context (used by file sources in Stage 2+).
 * @param spec - the source spec string.
 * @param options - per-source options (volume, ...).
 */
export async function buildSource(
  caco: Cacophony,
  _ctx: OfflineAudioContext,
  spec: string,
  options: BuildSourceOptions = {},
): Promise<SourceHandle> {
  if (!spec.startsWith("synth:")) {
    throw new Error(`File sources are not supported until CLI Stage 2 (got "${spec}")`);
  }

  const { frequency, type } = parseSynthSpec(spec);
  const synth: Synth = await caco.createOscillator({ frequency, type }, "stereo");
  if (options.volume !== undefined) {
    synth.volume = options.volume;
  }

  return {
    play() {
      synth.play();
    },
  };
}
