/**
 * The CLI command core: mode-agnostic builders shared by render mode and,
 * later, live mode. Stage 2 adds the FILE source branch to {@link buildSource}
 * and the {@link buildFxBus} effect-chain builder.
 */

import type { OfflineAudioContext } from "node-web-audio-api";
import type { Bus } from "../bus";
import type { Cacophony, LoopCount, PanType, Position } from "../cacophony";
import { encodeMonoToFoaSN3D } from "../index";
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
  /** Pan type — `"HRTF"` enables 3D spatial panning. Default `"stereo"`. */
  panType?: PanType;
  /** Spatial position `[x, y, z]` (only meaningful with `panType: "HRTF"`). */
  position?: Position;
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
  const panType: PanType = options.panType ?? "stereo";

  if (spec.startsWith("synth:")) {
    const { frequency, type } = parseSynthSpec(spec);
    const synth: Synth = await caco.createOscillator({ frequency, type }, panType);
    if (options.volume !== undefined) {
      synth.volume = options.volume;
    }
    if (options.loop !== undefined) {
      throw new Error("--loop is only valid for file sources, not synths");
    }
    if (options.position !== undefined) {
      synth.position = options.position;
    }
    return {
      play: () => synth.play(),
      source: synth,
    };
  }

  // File source: decode from disk, then create a buffer-backed Sound.
  const buffer = await decodeAudioFile(ctx as unknown as Parameters<typeof decodeAudioFile>[0], spec);
  const sound: Sound = await caco.createSound(buffer, "buffer", panType);
  if (options.volume !== undefined) {
    sound.volume = options.volume;
  }
  if (options.loop !== undefined) {
    sound.loop(options.loop);
  }
  if (options.position !== undefined) {
    sound.position = options.position;
  }
  return {
    play: () => sound.play(),
    source: sound,
  };
}

/**
 * Apply a pitch-shift to a freshly-PLAYED Sound and await it.
 *
 * Pitch-shift is fanned out across LIVE playbacks: `preplay()` only kicks off
 * the async worklet `setPitchShift` (fire-and-forget, `sound.ts:263`). In an
 * offline render `startRendering()` runs immediately after `play()`, so the
 * worklet would not be built in time. The reliable order is: `play()` (create
 * the playback), THEN `await source.setPitchShift(factor)` (build + set the
 * worklet param on that live playback), THEN render — verified by spike
 * (centroid 499→984 Hz only with this ordering).
 *
 * @param source - the played Sound (no-op for Synths, which have no buffer).
 * @param factor - pitch multiplier (1 = no shift).
 */
export async function applyPitchAfterPlay(source: Sound | Synth, factor: number | undefined): Promise<void> {
  if (factor === undefined || factor === 1) return;
  if (!("setPitchShift" in source)) {
    throw new Error("--pitch is only valid for file sources, not synths");
  }
  await (source as Sound).setPitchShift(factor);
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

/** Minimal slice of the audio context the FOA builder needs. */
interface FoaContextLike {
  sampleRate: number;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): { buffer: AudioBuffer | null; loop: boolean; connect(dest: unknown): void; start(): void };
  destination: AudioNode;
}

/** Options for {@link buildFoaSource}. */
export interface FoaOptions {
  /** Azimuth in degrees (positive = left, negative = right), per the encoder. */
  azimuthDeg: number;
  /** Elevation in degrees. Default 0. */
  elevationDeg?: number;
  /** Tone frequency in Hz. Default 440. */
  frequency?: number;
  /** Tone amplitude. Default 0.3. */
  amplitude?: number;
  /** Buffer length in frames. Default fills the whole render. */
  lengthFrames: number;
  /** Optional HRIR injection (the plan R3 fallback). Omit to use the bundled HRIR. */
  hrir?: AudioBuffer;
}

/**
 * Build a FOA (first-order ambisonic) spatial source: encode a mono tone to a
 * 4-channel SN3D buffer at the given azimuth/elevation, then decode it to
 * binaural via {@link Cacophony.createFoaDecoder} with EXPLICIT graph wiring
 * (`src.connect(decoder.input)`, `decoder.output.connect(target)`) — NOT
 * `bus.addFilter`, because the decoder is 4-ch-in / 2-ch-out.
 *
 * Mirrors `index.html:863-892`. R3 spike confirmed the bundled-HRIR fetch works
 * headless against the built dist; `opts.hrir` is the documented injection
 * fallback.
 *
 * @param caco - the Cacophony instance.
 * @param ctx - the backing audio context (offline render or live).
 * @param target - the node to route the decoded stereo into (a bus input or the
 *   context destination).
 * @param opts - FOA parameters.
 * @returns a handle whose `play()` starts the encoded source.
 */
export async function buildFoaSource(
  caco: Cacophony,
  ctx: FoaContextLike,
  target: AudioNode,
  opts: FoaOptions,
): Promise<{ play(): void }> {
  const sr = ctx.sampleRate;
  const len = opts.lengthFrames;
  const frequency = opts.frequency ?? 440;
  const amplitude = opts.amplitude ?? 0.3;
  const azRad = (opts.azimuthDeg * Math.PI) / 180;
  const elRad = ((opts.elevationDeg ?? 0) * Math.PI) / 180;

  const buf = ctx.createBuffer(4, len, sr);
  const ch = [0, 1, 2, 3].map((c) => buf.getChannelData(c));
  for (let i = 0; i < len; i++) {
    const s = Math.sin((2 * Math.PI * frequency * i) / sr) * amplitude;
    const [w, y, z, x] = encodeMonoToFoaSN3D(s, azRad, elRad);
    ch[0][i] = w;
    ch[1][i] = y;
    ch[2][i] = z;
    ch[3][i] = x;
  }

  const decoder = await caco.createFoaDecoder(opts.hrir ? { hrir: opts.hrir } : undefined);
  decoder.output.connect(target);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(decoder.input);

  return {
    play: () => src.start(),
  };
}

/**
 * Build a group from multiple file sources and return a handle whose `play()`
 * starts all sounds at once (`createGroup(...).play()`).
 *
 * @param caco - the Cacophony instance.
 * @param ctx - the backing context (used to decode each file).
 * @param files - the source files (paths) to load into the group.
 */
export async function buildGroup(
  caco: Cacophony,
  ctx: OfflineAudioContext,
  files: readonly string[],
): Promise<{ play(): void; group: Awaited<ReturnType<Cacophony["createGroup"]>> }> {
  const sounds: Sound[] = [];
  for (const file of files) {
    const buffer = await decodeAudioFile(ctx as unknown as Parameters<typeof decodeAudioFile>[0], file);
    sounds.push(await caco.createSound(buffer, "buffer", "stereo"));
  }
  const group = await caco.createGroup(sounds);
  return {
    play: () => void group.play(),
    group,
  };
}
