/**
 * CLI top-level dispatch. Handles `render` (offline → WAV), the live one-shot
 * subcommands `play` / `synth`, and the interactive `repl`, plus `--help` /
 * `--version`.
 */
import { parseArgs } from "node:util";
import type { LoopCount } from "../cacophony";
import { parseFxToken } from "./commands";
import { parseKvParams } from "./effects-registry";
import { runLive } from "./live";
import { meterFile } from "./meter";
import { type FoaRenderSpec, renderToFile } from "./render";
import { runRepl } from "./repl";
import type { WavBitDepth } from "./wav";

const VERSION = "0.25.1";

const HELP = `cacophony — headless audio CLI (render / live / repl)

Usage:
  cacophony play  <file...>  [options]       play file(s) live to the speakers
  cacophony synth <freq> [wave] [options]    play an oscillator live
  cacophony render <source> --out <path.wav> [options]   offline render to WAV
  cacophony meter <file> [--duration <sec>]  print integrated loudness (LUFS)
  cacophony repl                             interactive live graph

Source (render):
  synth:<freq>[:<wave>]   oscillator synth (wave: sine|sawtooth|square|triangle, default sine)
  <path>                  an audio file (wav/ogg/mp3/flac/...) decoded from disk
  <path> <path...>        multiple files render as a group (summed)

play options:
  --loop <n|infinite>     loop the source
  --volume <0..1>         source gain
  --duration <sec>        stop and exit after N seconds (default: until end / Ctrl-C)
  --pan stereo|hrtf       pan type (hrtf = 3D spatial)
  --pos x,y,z             spatial position (with --pan hrtf)
  --pitch <factor>        pitch shift (2 = +1 octave; file sources only)

synth options:
  --volume <0..1>         source gain
  --duration <sec>        stop and exit after N seconds (default: until Ctrl-C)

render options:
  --out <path>            output WAV path (required)
  --fx <name>[:k=v,...]   add an effect (repeatable; chained on a bus in order)
  --fx foa:azimuth=<deg>[,elevation=<deg>]   ambisonic FOA → binaural spatial render
  --duration <sec>        render duration in seconds (default 1)
  --sample-rate <hz>      sample rate (default 48000)
  --channels <1|2>        channel count (default 2)
  --bits <16|32>          16 = PCM s16 (default), 32 = IEEE float
  --loop <n|infinite>     loop the source
  --volume <0..1>         source gain
  --pan stereo|hrtf       pan type; --pos x,y,z   spatial position
  --pitch <factor>        pitch shift (file sources only)
  --stretch <factor>      time-stretch (changes length, preserves pitch; file sources)

  --help                  show this help
  --version               print version
`;

function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${flag}: "${value}" (expected a positive integer)`);
  }
  return n;
}

function parsePositiveNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${flag}: "${value}" (expected a positive number)`);
  }
  return n;
}

/** Parse an optional `--volume <0..1>` flag value. */
function parseVolumeFlag(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`Invalid --volume: "${value}" (expected a number >= 0)`);
  }
  return v;
}

/** Parse a `--pos x,y,z` flag into a `[x,y,z]` tuple. */
function parsePosFlag(value: string | undefined): [number, number, number] | undefined {
  if (value === undefined) return undefined;
  const parts = value.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid --pos: "${value}" (expected x,y,z e.g. 1,0,0)`);
  }
  return [parts[0], parts[1], parts[2]];
}

/** Parse a positive-or-any finite factor flag (`--pitch` / `--stretch`). */
function parseFactorFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${flag}: "${value}" (expected a positive number)`);
  }
  return n;
}

/** Parse `foa` fx params (`azimuth=<deg>[,elevation=<deg>]`) into a render spec. */
function parseFoaParams(params: string): FoaRenderSpec {
  const opts = parseKvParams({ azimuth: "num", elevation: "num" }, params);
  if (typeof opts.azimuth !== "number") {
    throw new Error("fx foa requires azimuth=<deg> (e.g. --fx foa:azimuth=90)");
  }
  return {
    azimuthDeg: opts.azimuth,
    elevationDeg: typeof opts.elevation === "number" ? opts.elevation : undefined,
  };
}

/** Parse an optional `--loop <n|infinite>` flag value. */
function parseLoopFlag(value: string | undefined): LoopCount | undefined {
  if (value === undefined) return undefined;
  if (value === "infinite") return "infinite";
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid --loop: "${value}" (expected a non-negative integer or "infinite")`);
  }
  return n;
}

async function runRender(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      out: { type: "string" },
      fx: { type: "string", multiple: true },
      duration: { type: "string" },
      "sample-rate": { type: "string" },
      channels: { type: "string" },
      bits: { type: "string" },
      loop: { type: "string" },
      volume: { type: "string" },
      pan: { type: "string" },
      pos: { type: "string" },
      pitch: { type: "string" },
      stretch: { type: "string" },
    },
  });

  const source = positionals[0];
  if (!source) {
    throw new Error("render: missing <source> (e.g. synth:220:sawtooth)");
  }
  if (!values.out) {
    throw new Error("render: missing --out <path.wav>");
  }
  // Extra positionals after the source become group members.
  const groupSources = positionals.slice(1);

  const durationSec = values.duration ? parsePositiveNumber(values.duration, "--duration") : 1;
  const sampleRate = values["sample-rate"] ? parsePositiveInt(values["sample-rate"], "--sample-rate") : 48000;

  let numberOfChannels = 2;
  if (values.channels !== undefined) {
    if (values.channels !== "1" && values.channels !== "2") {
      throw new Error(`Invalid --channels: "${values.channels}" (expected 1 or 2)`);
    }
    numberOfChannels = Number(values.channels);
  }

  let bitDepth: WavBitDepth = 16;
  if (values.bits !== undefined) {
    if (values.bits !== "16" && values.bits !== "32") {
      throw new Error(`Invalid --bits: "${values.bits}" (expected 16 or 32)`);
    }
    bitDepth = Number(values.bits) as WavBitDepth;
  }

  const volume = parseVolumeFlag(values.volume);
  const loop = parseLoopFlag(values.loop);

  let pan: "stereo" | "hrtf" | undefined;
  if (values.pan !== undefined) {
    if (values.pan !== "stereo" && values.pan !== "hrtf") {
      throw new Error(`Invalid --pan: "${values.pan}" (expected stereo or hrtf)`);
    }
    pan = values.pan;
  }
  const position = parsePosFlag(values.pos);
  const pitch = parseFactorFlag(values.pitch, "--pitch");
  const stretch = parseFactorFlag(values.stretch, "--stretch");

  // Each --fx value is one `name[:k=v,...]` token; split AFTER parseArgs so the
  // `=` / `,` in the params survive (Risk R6). `foa` is NOT a bus filter (the
  // FOA decoder is 4-ch-in/2-ch-out) — extract it as a spatial render request.
  const fxTokens = (values.fx ?? []).map(parseFxToken);
  let foa: FoaRenderSpec | undefined;
  const fx = fxTokens.filter((t) => {
    if (t.name !== "foa") return true;
    foa = parseFoaParams(t.params);
    return false;
  });

  const result = await renderToFile(
    {
      source,
      groupSources: groupSources.length > 0 ? groupSources : undefined,
      durationSec,
      sampleRate,
      numberOfChannels,
      volume,
      loop,
      fx,
      pan,
      position,
      pitch,
      stretch,
      foa,
    },
    values.out,
    bitDepth,
  );

  process.stdout.write(
    `Rendered ${source} -> ${result.outPath}\n` +
      `  ${result.stats.frames} frames, ${result.stats.channels} ch @ ${result.stats.sampleRate} Hz, ` +
      `${result.bitDepth}-bit, ${result.bytesWritten} bytes\n` +
      `  peak ${result.stats.peak.toFixed(4)}, non-silent samples ${result.stats.nonSilentSamples}\n`,
  );

  return 0;
}

/** `cacophony play <file...> [--loop --volume --pan --pos --pitch --duration]`. */
async function runPlay(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      loop: { type: "string" },
      volume: { type: "string" },
      duration: { type: "string" },
      // Accepted-and-deferred to Stage 5 (spatial / pitch). Parsed so the flags
      // don't error, but not yet applied.
      pan: { type: "string" },
      pos: { type: "string" },
      pitch: { type: "string" },
    },
  });

  const file = positionals[0];
  if (!file) {
    throw new Error("play: missing <file> (e.g. play test.ogg)");
  }

  let pan: "stereo" | "hrtf" | undefined;
  if (values.pan !== undefined) {
    if (values.pan !== "stereo" && values.pan !== "hrtf") {
      throw new Error(`Invalid --pan: "${values.pan}" (expected stereo or hrtf)`);
    }
    pan = values.pan;
  }

  const durationSec = values.duration ? parsePositiveNumber(values.duration, "--duration") : undefined;

  await runLive({
    source: file,
    groupSources: positionals.length > 1 ? positionals.slice(1) : undefined,
    volume: parseVolumeFlag(values.volume),
    loop: parseLoopFlag(values.loop),
    durationSec,
    pan,
    position: parsePosFlag(values.pos),
    pitch: parseFactorFlag(values.pitch, "--pitch"),
  });
  return 0;
}

/** `cacophony synth <freq> [wave] [--volume --duration]`. */
async function runSynth(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      volume: { type: "string" },
      duration: { type: "string" },
    },
  });

  const freq = positionals[0];
  if (!freq) {
    throw new Error("synth: missing <freq> (e.g. synth 440 sawtooth)");
  }
  const wave = positionals[1];
  const spec = wave ? `synth:${freq}:${wave}` : `synth:${freq}`;
  const durationSec = values.duration ? parsePositiveNumber(values.duration, "--duration") : undefined;

  await runLive({
    source: spec,
    volume: parseVolumeFlag(values.volume),
    durationSec,
  });
  return 0;
}

/** `cacophony meter <file> [--duration <sec>]` — print integrated loudness. */
async function runMeter(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { duration: { type: "string" } },
  });

  const file = positionals[0];
  if (!file) {
    throw new Error("meter: missing <file> (e.g. meter test.ogg)");
  }
  const durationSec = values.duration ? parsePositiveNumber(values.duration, "--duration") : undefined;

  const r = await meterFile(file, durationSec);
  const lkfs = Number.isFinite(r.integratedLkfs) ? `${r.integratedLkfs.toFixed(2)} LUFS` : "-inf (silent)";
  const peak = Number.isFinite(r.peakDbfs) ? `${r.peakDbfs.toFixed(2)} dBFS` : "-inf";
  process.stdout.write(
    `${r.file}: ${r.channels} ch @ ${r.sampleRate} Hz, ${r.frames} frames\n` +
      `  integrated loudness ${lkfs}\n` +
      `  sample peak         ${peak}\n`,
  );
  return 0;
}

/**
 * Run the CLI. Returns a process exit code. `argv` is the args AFTER
 * `node <script>` (i.e. `process.argv.slice(2)`).
 */
export async function run(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (command === "render") {
    return runRender(rest);
  }
  if (command === "meter") {
    return runMeter(rest);
  }
  if (command === "play") {
    return runPlay(rest);
  }
  if (command === "synth") {
    return runSynth(rest);
  }
  if (command === "repl") {
    await runRepl();
    return 0;
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 1;
}

/** Entry used by `bin/cacophony.mjs`: run and set the process exit code. */
export async function main(argv: readonly string[]): Promise<void> {
  try {
    process.exitCode = await run(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`cacophony: ${message}\n`);
    process.exitCode = 1;
  }
}
