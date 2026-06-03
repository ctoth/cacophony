/**
 * Render-mode runner: build a source in an OfflineAudioContext, render it
 * deterministically, encode the result to WAV, and write it to disk.
 *
 * This is the testable core of the CLI — a deterministic AudioBuffer in,
 * sample stats out — so {@link renderToBuffer} is exposed separately from the
 * file-writing {@link renderToFile}.
 */
import { writeFileSync } from "node:fs";
import type { LoopCount } from "../cacophony";
import { createOfflineNodeCacophony } from "../node";
import { buildFxBus, buildSource, type FxSpec } from "./commands";
import { encodeWav, type WavBitDepth } from "./wav";

/** Parameters for a render. */
export interface RenderParams {
  /** Source spec: `synth:<freq>[:<wave>]` or a file path. */
  source: string;
  /** Render duration in seconds. */
  durationSec: number;
  /** Render sample rate in Hz. */
  sampleRate: number;
  /** Channel count of the render buffer. */
  numberOfChannels: number;
  /** Linear gain applied to the source. */
  volume?: number;
  /** Loop the source (count or `"infinite"`). */
  loop?: LoopCount;
  /** Effect chain, applied in order on an anonymous bus the source routes to. */
  fx?: readonly FxSpec[];
}

/** Stats describing a rendered buffer. */
export interface RenderStats {
  frames: number;
  channels: number;
  sampleRate: number;
  /** Peak absolute sample value across channel 0. */
  peak: number;
  /** Count of samples (channel 0) above the silence threshold. */
  nonSilentSamples: number;
}

const SILENCE_THRESHOLD = 1e-4;

/** Peak + non-silent count over channel 0 of a rendered buffer. */
export function bufferStats(buffer: AudioBuffer): RenderStats {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const data = new Float32Array(frames);
  buffer.copyFromChannel(data, 0);

  let peak = 0;
  let nonSilent = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
    if (a > SILENCE_THRESHOLD) nonSilent++;
  }

  return {
    frames,
    channels,
    sampleRate: buffer.sampleRate,
    peak,
    nonSilentSamples: nonSilent,
  };
}

/**
 * The offline-Cacophony factory {@link renderToBuffer} drives. Defaults to the
 * source `createOfflineNodeCacophony`; tests that need worklet-backed effects to
 * actually run inject the BUILT `dist/node.mjs` factory instead, because the
 * worklet bundles are only inlined as `data:` URLs in the built bundle (under
 * source the `?url` imports resolve to bare paths the Node worklet loader cannot
 * fetch). See the Stage 2 report for the full rationale.
 */
export type OfflineCacophonyFactory = typeof createOfflineNodeCacophony;

/**
 * Render a source to an in-memory `AudioBuffer`. Quiet (worklet logs
 * suppressed) and deterministic — the unit of test.
 *
 * @param params - the render parameters.
 * @param makeOffline - the offline-Cacophony factory (injectable for tests).
 */
export async function renderToBuffer(
  params: RenderParams,
  makeOffline: OfflineCacophonyFactory = createOfflineNodeCacophony,
): Promise<AudioBuffer> {
  const length = Math.ceil(params.sampleRate * params.durationSec);
  const { cacophony, context } = makeOffline({
    length,
    sampleRate: params.sampleRate,
    numberOfChannels: params.numberOfChannels,
    quiet: true,
  });

  const source = await buildSource(cacophony, context, params.source, {
    volume: params.volume,
    loop: params.loop,
  });

  if (params.fx && params.fx.length > 0) {
    const { bus } = await buildFxBus(cacophony, params.fx);
    source.source.routeTo(bus);
  }

  source.play();

  return context.startRendering();
}

/** Result of a render-to-file run. */
export interface RenderToFileResult {
  outPath: string;
  bytesWritten: number;
  bitDepth: WavBitDepth;
  stats: RenderStats;
}

/**
 * Render a source and write it to `outPath` as WAV. Returns the output path,
 * file size, and render stats.
 */
export async function renderToFile(
  params: RenderParams,
  outPath: string,
  bitDepth: WavBitDepth = 16,
): Promise<RenderToFileResult> {
  const buffer = await renderToBuffer(params);
  const stats = bufferStats(buffer);
  const wav = encodeWav(buffer as unknown as Parameters<typeof encodeWav>[0], { bitDepth });
  writeFileSync(outPath, wav);
  return { outPath, bytesWritten: wav.length, bitDepth, stats };
}
