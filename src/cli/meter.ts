/**
 * Loudness metering for the one-shot `cacophony meter <file>` subcommand.
 *
 * Uses the OFFLINE, deterministic `integratedLoudness` (BS.1770-5) imported from
 * the package index (`../index`), NOT the live worklet meter — the offline path
 * is the gate (plan R4). The file is decoded to an AudioBuffer in an offline
 * context, then each channel's samples are fed to `integratedLoudness`.
 *
 * The 997 Hz 0 dBFS → −3.01 LKFS self-check (the HEADLINE proof) exercises this
 * exact `integratedLoudness` function; see `test/cli/loudness.test.ts`.
 */
import { integratedLoudness } from "../index";
import { createOfflineNodeCacophony, decodeAudioFile } from "../node";

/** BS.1770-5 channel labels by index for a stereo (or mono) decode. */
const STEREO_LABELS = ["L", "R"] as const;

/** Result of a {@link meterFile} measurement. */
export interface MeterResult {
  /** Source file path. */
  file: string;
  channels: number;
  sampleRate: number;
  frames: number;
  /** Integrated loudness (LKFS / LUFS) over all channels together. */
  integratedLkfs: number;
  /** True-peak proxy: the max absolute sample across channels, in dBTP-ish dBFS. */
  peakDbfs: number;
}

/** Largest absolute sample across a Float32Array. */
function peakAbs(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > p) p = a;
  }
  return p;
}

/**
 * Decode `file` and compute its integrated loudness (LKFS) plus a sample-peak
 * (dBFS). Decoding uses an offline context purely as a decoder host (no render).
 *
 * @param file - path to an audio file (wav/ogg/mp3/flac/...).
 * @param durationSec - optional cap; only the first N seconds are measured.
 */
export async function meterFile(file: string, durationSec?: number): Promise<MeterResult> {
  // A tiny offline context is the cheapest decoder host. Its length doesn't
  // gate `decodeAudioFile` (which returns the full decoded buffer).
  const { context } = await createOfflineNodeCacophony({
    length: 1,
    sampleRate: 48000,
    numberOfChannels: 2,
    quiet: true,
  });
  const buffer = await decodeAudioFile(context as unknown as Parameters<typeof decodeAudioFile>[0], file);

  const sampleRate = buffer.sampleRate;
  const total = buffer.length;
  const frames = durationSec !== undefined ? Math.min(total, Math.ceil(sampleRate * durationSec)) : total;

  const inputs: { channel: "L" | "R" | "C"; samples: Float32Array }[] = [];
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const full = new Float32Array(total);
    buffer.copyFromChannel(full, c);
    const samples = frames === total ? full : full.subarray(0, frames);
    peak = Math.max(peak, peakAbs(samples));
    // Mono → single "C" (centre); stereo → L/R; >2ch → measure first two.
    const label = buffer.numberOfChannels === 1 ? "C" : STEREO_LABELS[c];
    if (label !== undefined) inputs.push({ channel: label, samples });
  }

  const integratedLkfs = integratedLoudness(inputs, sampleRate);
  const peakDbfs = peak > 0 ? 20 * Math.log10(peak) : -Infinity;

  return {
    file,
    channels: buffer.numberOfChannels,
    sampleRate,
    frames,
    integratedLkfs,
    peakDbfs,
  };
}
