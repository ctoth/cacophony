/**
 * CLI top-level dispatch. Handles `render` (offline → WAV), the live one-shot
 * subcommands `play` / `synth`, and the interactive `repl`, plus `--help` /
 * `--version`.
 */
import { parseArgs } from "node:util";
import type { LoopCount } from "../cacophony";
import { parseFxToken } from "./commands";
import { runLive } from "./live";
import { renderToFile } from "./render";
import { runRepl } from "./repl";
import type { WavBitDepth } from "./wav";

const VERSION = "0.25.1";

const HELP = `cacophony — headless audio CLI (render / live / repl)

Usage:
  cacophony play  <file...>  [options]       play file(s) live to the speakers
  cacophony synth <freq> [wave] [options]    play an oscillator live
  cacophony render <source> --out <path.wav> [options]   offline render to WAV
  cacophony repl                             interactive live graph

Source (render):
  synth:<freq>[:<wave>]   oscillator synth (wave: sine|sawtooth|square|triangle, default sine)
  <path>                  an audio file (wav/ogg/mp3/flac/...) decoded from disk

play options:
  --loop <n|infinite>     loop the source
  --volume <0..1>         source gain
  --duration <sec>        stop and exit after N seconds (default: until end / Ctrl-C)
  --pan stereo|hrtf       pan type (hrtf deferred to Stage 5)
  --pos x,y,z             spatial position (deferred to Stage 5)
  --pitch <factor>        pitch shift (deferred to Stage 5)

synth options:
  --volume <0..1>         source gain
  --duration <sec>        stop and exit after N seconds (default: until Ctrl-C)

render options:
  --out <path>            output WAV path (required)
  --fx <name>[:k=v,...]   add an effect (repeatable; chained on a bus in order)
  --duration <sec>        render duration in seconds (default 1)
  --sample-rate <hz>      sample rate (default 48000)
  --channels <1|2>        channel count (default 2)
  --bits <16|32>          16 = PCM s16 (default), 32 = IEEE float
  --loop <n|infinite>     loop the source
  --volume <0..1>         source gain

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
    },
  });

  const source = positionals[0];
  if (!source) {
    throw new Error("render: missing <source> (e.g. synth:220:sawtooth)");
  }
  if (!values.out) {
    throw new Error("render: missing --out <path.wav>");
  }

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

  // Each --fx value is one `name[:k=v,...]` token; split AFTER parseArgs so the
  // `=` / `,` in the params survive (Risk R6).
  const fx = (values.fx ?? []).map(parseFxToken);

  const result = await renderToFile(
    { source, durationSec, sampleRate, numberOfChannels, volume, loop, fx },
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
  if (positionals.length > 1) {
    // Multi-file group playback is Stage 5; play the first file for now.
    process.stderr.write("cacophony: multiple files given — playing the first (group playback is Stage 5)\n");
  }
  if (values.pan !== undefined && values.pan !== "stereo") {
    process.stderr.write("cacophony: --pan hrtf and --pos are deferred to Stage 5; using stereo\n");
  }
  if (values.pitch !== undefined) {
    process.stderr.write("cacophony: --pitch is deferred to Stage 5; ignoring\n");
  }

  const durationSec = values.duration ? parsePositiveNumber(values.duration, "--duration") : undefined;

  await runLive({
    source: file,
    volume: parseVolumeFlag(values.volume),
    loop: parseLoopFlag(values.loop),
    durationSec,
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
