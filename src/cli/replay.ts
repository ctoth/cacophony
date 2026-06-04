/**
 * REPL `render` support (plan Risk R5): the live REPL graph runs on a real-time
 * context and cannot `startRendering()`. Instead the REPL keeps a declarative
 * {@link LoggedCommand} log; `render` REPLAYS that log into a fresh
 * `createOfflineNodeCacophony` and writes a WAV. Live-only tweaks (`param ...
 * over <ms>` ramps) are snapshotted to their final value when logged, so the
 * replay is a clean offline reconstruction — no real-time→offline transplant.
 *
 * Replayable today (spiked R5): `synth`, `load`, `vol`, `pitch`, `pos`/HRTF,
 * `fx add`, `param` (final value), `route`/`route master`. Documented as
 * deferred: `stretch` (it mutates the live handle in place), `group`, `foa`,
 * `bypass` toggles, and live meter state — these are recorded as comments only.
 */
import { writeFileSync } from "node:fs";
import type { Bus } from "../bus";
import { createOfflineNodeCacophony } from "../node";
import type { Sound } from "../sound";
import type { Synth } from "../synth";
import { applyPitchAfterPlay, buildSource } from "./commands";
import { aliasesFor, EFFECT_REGISTRY, parseKvParams } from "./effects-registry";
import type { OfflineCacophonyFactory } from "./render";
import { bufferStats, type RenderStats } from "./render";
import type { LoggedCommand } from "./session";
import { encodeWav, type WavBitDepth } from "./wav";

/** Parameters for a REPL-log replay render. */
export interface ReplayParams {
  durationSec: number;
  sampleRate: number;
  numberOfChannels: number;
  bitDepth: WavBitDepth;
}

/** Result of a REPL `render`. */
export interface ReplayResult {
  outPath: string;
  bytesWritten: number;
  stats: RenderStats;
  /** Commands that could not be replayed (documented as skipped). */
  skipped: string[];
}

/**
 * Replay a command log into an offline render and return the AudioBuffer plus a
 * list of skipped (non-replayable) commands. Injectable factory for tests.
 */
export async function replayToBuffer(
  log: readonly LoggedCommand[],
  params: ReplayParams,
  makeOffline: OfflineCacophonyFactory = createOfflineNodeCacophony,
): Promise<{ buffer: AudioBuffer; skipped: string[] }> {
  const length = Math.ceil(params.sampleRate * params.durationSec);
  const { cacophony, context } = makeOffline({
    length,
    sampleRate: params.sampleRate,
    numberOfChannels: params.numberOfChannels,
    quiet: true,
  });

  const sources = new Map<string, Sound | Synth>();
  const buses = new Map<string, Bus>();
  const skipped: string[] = [];
  // Pitch is applied AFTER play() (see applyPitchAfterPlay); collect the final
  // factor per source and apply once each source has a live playback.
  const pitchByName = new Map<string, number>();

  const busFor = (name: string): Bus => {
    let bus = buses.get(name);
    if (!bus) {
      bus = cacophony.getBus(name) ?? cacophony.createBus(name);
      buses.set(name, bus);
    }
    return bus;
  };

  for (const cmd of log) {
    switch (cmd.kind) {
      case "synth": {
        const spec = cmd.wave ? `synth:${cmd.freq}:${cmd.wave}` : `synth:${cmd.freq}`;
        const handle = await buildSource(cacophony, context, spec);
        sources.set(cmd.name, handle.source);
        break;
      }
      case "load": {
        const handle = await buildSource(cacophony, context, cmd.file);
        sources.set(cmd.name, handle.source);
        break;
      }
      case "vol": {
        const s = sources.get(cmd.name);
        if (s) s.volume = cmd.gain;
        break;
      }
      case "pitch": {
        // Snapshot the final factor; applied after the source is played.
        pitchByName.set(cmd.name, cmd.factor);
        break;
      }
      case "pos": {
        const s = sources.get(cmd.name);
        if (s) s.position = cmd.position;
        break;
      }
      case "fx": {
        const def = EFFECT_REGISTRY[cmd.effect];
        if (!def) {
          skipped.push(`fx add ${cmd.effect} (unknown effect)`);
          break;
        }
        const opts = parseKvParams(def.schema, cmd.params, aliasesFor(cmd.effect));
        const bus = busFor(cmd.busName);
        await bus.addFilter(def.factory(cacophony, opts) as Parameters<typeof bus.addFilter>[0]);
        break;
      }
      case "param": {
        const bus = busFor(cmd.busName);
        const node = bus.filters[cmd.idx];
        if (node) bus.rampFilterParam(node, cmd.param, cmd.value);
        break;
      }
      case "route": {
        const s = sources.get(cmd.name);
        const bus = busFor(cmd.busName);
        if (s) s.routeTo(bus, cmd.sendGain);
        break;
      }
      case "routeMaster": {
        const s = sources.get(cmd.name);
        if (s) s.routeTo(cacophony.master);
        break;
      }
    }
  }

  // Start every source that was declared, then apply any pitch-shift (which
  // needs a live playback) and await it before rendering.
  for (const [name, s] of sources) {
    s.play();
    await applyPitchAfterPlay(s, pitchByName.get(name));
  }

  const buffer = await context.startRendering();
  return { buffer, skipped };
}

/** Replay a command log to a WAV file. */
export async function replayToFile(
  log: readonly LoggedCommand[],
  outPath: string,
  params: ReplayParams,
): Promise<ReplayResult> {
  const { buffer, skipped } = await replayToBuffer(log, params);
  const stats = bufferStats(buffer);
  const wav = encodeWav(buffer as unknown as Parameters<typeof encodeWav>[0], { bitDepth: params.bitDepth });
  writeFileSync(outPath, wav);
  return { outPath, bytesWritten: wav.length, stats, skipped };
}
