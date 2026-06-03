/**
 * CLI top-level dispatch. Stage 1 handles only `render` (plus `--help` /
 * `--version`); other subcommands land in later stages.
 */
import { parseArgs } from "node:util";
import { renderToFile } from "./render";
import type { WavBitDepth } from "./wav";

const VERSION = "0.25.1";

const HELP = `cacophony — offline audio render CLI

Usage:
  cacophony render <source> --out <path.wav> [options]

Source:
  synth:<freq>[:<wave>]   oscillator synth (wave: sine|sawtooth|square|triangle, default sine)

Render options:
  --out <path>            output WAV path (required)
  --duration <sec>        render duration in seconds (default 1)
  --sample-rate <hz>      sample rate (default 48000)
  --channels <1|2>        channel count (default 2)
  --bits <16|32>          16 = PCM s16 (default), 32 = IEEE float
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

async function runRender(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      out: { type: "string" },
      duration: { type: "string" },
      "sample-rate": { type: "string" },
      channels: { type: "string" },
      bits: { type: "string" },
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

  let volume: number | undefined;
  if (values.volume !== undefined) {
    const v = Number(values.volume);
    if (!Number.isFinite(v) || v < 0) {
      throw new Error(`Invalid --volume: "${values.volume}" (expected a number >= 0)`);
    }
    volume = v;
  }

  const result = await renderToFile(
    { source, durationSec, sampleRate, numberOfChannels, volume },
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
