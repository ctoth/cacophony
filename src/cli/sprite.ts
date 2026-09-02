import { writeFile } from "node:fs/promises";
import { parse } from "node:path";
import { parseArgs } from "node:util";
import type { SpriteMap } from "../audioSprite";
import type { AudioBuffer } from "../context";
import { createNodeCacophony, decodeAudioFile } from "../node";
import { encodeWav } from "./wav";

export interface SpriteAtlasResult {
  readonly buffer: AudioBuffer;
  readonly map: SpriteMap;
  readonly gapFrames: number;
}

interface BufferFactory {
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
}

/** Concatenate decoded inputs into one sample-frame-authoritative atlas. */
export function buildSpriteAtlas(
  context: BufferFactory,
  inputs: readonly { name: string; buffer: AudioBuffer }[],
  gapMs = 0,
): SpriteAtlasResult {
  if (inputs.length === 0) throw new Error("sprite: provide at least one input file");
  if (!Number.isFinite(gapMs) || gapMs < 0) {
    throw new Error(`Invalid --gap: "${gapMs}" (expected a finite number >= 0)`);
  }

  const sampleRate = inputs[0].buffer.sampleRate;
  const numberOfChannels = inputs[0].buffer.numberOfChannels;
  const names = new Set<string>();
  for (const input of inputs) {
    if (!input.name) throw new Error("sprite: input filename stem must not be empty");
    if (names.has(input.name)) throw new Error(`sprite: duplicate input name '${input.name}'`);
    names.add(input.name);
    if (input.buffer.numberOfChannels !== numberOfChannels) {
      throw new Error("sprite: inputs must have the same channel count");
    }
    if (input.buffer.sampleRate !== sampleRate) {
      throw new Error("sprite: decoded inputs must have the same sample rate");
    }
  }

  const gapFrames = Math.round((gapMs / 1_000) * sampleRate);
  const totalFrames = inputs.reduce((sum, input) => sum + input.buffer.length, 0) + gapFrames * (inputs.length - 1);
  const atlas = context.createBuffer(numberOfChannels, totalFrames, sampleRate);
  const map: Record<string, { start: number; duration: number }> = Object.create(null);
  let cursor = 0;

  for (const input of inputs) {
    map[input.name] = Object.freeze({
      start: cursor / sampleRate,
      duration: input.buffer.length / sampleRate,
    });
    for (let channel = 0; channel < numberOfChannels; channel++) {
      atlas.getChannelData(channel).set(input.buffer.getChannelData(channel), cursor);
    }
    cursor += input.buffer.length + gapFrames;
  }

  return { buffer: atlas, map: Object.freeze(map), gapFrames };
}

/** Decode files through one Node context and write the WAV atlas and JSON map. */
export async function generateSprite(
  inputs: readonly string[],
  outPath: string,
  mapPath: string,
  gapMs = 0,
  contextFactory: typeof createNodeCacophony = createNodeCacophony,
): Promise<SpriteAtlasResult> {
  const { context } = await contextFactory({ quiet: true, sinkId: { type: "none" } });
  try {
    const decoded = [];
    for (const input of inputs) {
      decoded.push({ name: parse(input).name, buffer: await decodeAudioFile(context, input) });
    }
    const result = buildSpriteAtlas(context, decoded, gapMs);
    await Promise.all([
      writeFile(outPath, encodeWav(result.buffer, { bitDepth: 32 })),
      writeFile(mapPath, `${JSON.stringify(result.map, null, 2)}\n`, "utf8"),
    ]);
    return result;
  } finally {
    await context.close();
  }
}

/** `cacophony sprite <input...> --out atlas.wav --map atlas.json [--gap ms]`. */
export async function runSprite(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      out: { type: "string" },
      map: { type: "string" },
      gap: { type: "string" },
    },
  });
  if (positionals.length === 0) throw new Error("sprite: provide at least one input file");
  if (!values.out) throw new Error("sprite: missing --out <atlas.wav>");
  if (!values.map) throw new Error("sprite: missing --map <atlas.json>");
  const gapMs = values.gap === undefined ? 0 : Number(values.gap);
  const result = await generateSprite(positionals, values.out, values.map, gapMs);
  process.stdout.write(
    `Generated ${values.out} and ${values.map}: ${result.buffer.length} frames, ${result.buffer.numberOfChannels} ch @ ${result.buffer.sampleRate} Hz\n`,
  );
  return 0;
}
