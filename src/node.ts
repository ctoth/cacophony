/**
 * Node / offline entry point for Cacophony — reached only via the
 * `cacophony/node` subpath export (never from the browser bundle).
 *
 * It wires Cacophony to the `node-web-audio-api` backend through the two
 * documented injection seams — the audio `context` constructor argument and
 * `runtimeOptions.createAudioWorkletNode` — so the full public API (synths,
 * buses, and the AudioWorklet effects whose bundles ship inlined as base64
 * `data:` URLs) runs headless under Node with zero library patching.
 *
 * IMPORTANT: a real-time `AudioContext` holds a keep-alive timer, so the
 * process will not exit until you `await context.close()`. Both factories
 * return the context alongside the Cacophony instance for exactly this reason;
 * call `await context.close()` on exit / Ctrl-C.
 *
 * `node-web-audio-api` is an OPTIONAL peer dependency — install it yourself
 * (`npm i node-web-audio-api`) to use this module.
 */
import { readFile } from "node:fs/promises";
import { AudioContext, AudioWorkletNode, OfflineAudioContext } from "node-web-audio-api";
import type { ICache } from "./cache";
import { Cacophony, type RuntimeOptions } from "./cacophony";
import type { BaseContext } from "./context";
import type { CacophonyLogger } from "./logger";

/**
 * The worklet-node factory Cacophony needs on the Node backend, where
 * `AudioWorkletNode` is not a global. Bridges to `node-web-audio-api`'s
 * constructor.
 */
const createAudioWorkletNode: NonNullable<RuntimeOptions["createAudioWorkletNode"]> = (context, name, options) =>
  new AudioWorkletNode(context as ConstructorParameters<typeof AudioWorkletNode>[0], name, options);

/** Per-source-URL memoized `blob:` URL of a worklet bundle (built on first use). */
const workletBlobUrlByDataUrl = new Map<string, string>();

/**
 * Worklet-URL resolver for the Node backend: rewrites the library's inlined
 * base64 `data:` worklet bundles into `blob:` URLs, leaving any other URL
 * (`http:`, `file:`) untouched.
 *
 * The browser build inlines every worklet bundle as a `data:` URL, which the
 * browser loads directly — but `node-web-audio-api`'s `addModule` resolver has
 * no `data:` branch, so those bundles never load under Node. Its `blob:`
 * branch DOES work: it reads the blob to source text on the main thread and
 * hands that text to the worker as a `data:` module. (Returning a bare file
 * path instead is not portable — the worker `import()`s whatever it is given,
 * and Node's ESM loader rejects absolute paths on Windows, where `C:\…` parses
 * as protocol `c:`.) The bundle source already rides inside the `data:` URL, so
 * we decode it straight from there — no bundle files on disk are needed, which
 * keeps the published `cacophony/node` adapter self-contained in `dist`.
 */
const resolveWorkletUrl: NonNullable<RuntimeOptions["resolveWorkletUrl"]> = async (_name, url) => {
  if (!url.startsWith("data:")) {
    return url;
  }
  const cached = workletBlobUrlByDataUrl.get(url);
  if (cached) {
    return cached;
  }
  // `fetch` decodes the `data:` URL (base64 + charset) into the bundle source.
  const code = await (await fetch(url)).text();
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  workletBlobUrlByDataUrl.set(url, blobUrl);
  return blobUrl;
};

/** Shared options for routing Cacophony's host-side diagnostics. */
interface LoggingOptions {
  /** Optional logger for the `[cacophony/worklet]` diagnostics. */
  logger?: CacophonyLogger;
  /** Suppress all host-side diagnostics (ignored when `logger` is set). */
  quiet?: boolean;
}

/** Options for {@link createNodeCacophony}. */
export interface NodeCacophonyOptions extends LoggingOptions {
  /**
   * Real-time context to use. When omitted, a fresh `AudioContext` is
   * constructed (a `playback` latency hint is applied for portability —
   * notably to avoid choppy output under Linux ALSA).
   */
  context?: AudioContext;
  /** Optional cache implementation (defaults to Cacophony's `AudioCache`). */
  cache?: ICache;
}

/** Options for {@link createOfflineNodeCacophony}. */
export interface OfflineNodeCacophonyOptions extends LoggingOptions {
  /** Channel count of the render buffer. @default 2 */
  numberOfChannels?: number;
  /** Length of the render buffer, in sample frames. */
  length: number;
  /** Sample rate of the render buffer, in Hz. */
  sampleRate: number;
  /** Optional cache implementation (defaults to Cacophony's `AudioCache`). */
  cache?: ICache;
}

/** A Cacophony instance paired with the context that backs it. */
export interface NodeCacophony {
  cacophony: Cacophony;
  context: AudioContext;
}

/** An offline Cacophony instance paired with its render context. */
export interface OfflineNodeCacophony {
  cacophony: Cacophony;
  context: OfflineAudioContext;
}

/**
 * Create a real-time Cacophony wired to the `node-web-audio-api` backend.
 *
 * The returned `context` is exposed deliberately: a real-time AudioContext
 * keeps the Node process alive, so callers MUST `await context.close()` when
 * done (e.g. on exit or Ctrl-C) for the process to terminate.
 */
export function createNodeCacophony(options: NodeCacophonyOptions = {}): NodeCacophony {
  const context = options.context ?? new AudioContext({ latencyHint: "playback" });
  const cacophony = new Cacophony(context as unknown as BaseContext, options.cache, {
    createAudioWorkletNode,
    resolveWorkletUrl,
    logger: options.logger,
    quiet: options.quiet,
  });
  return { cacophony, context };
}

/**
 * Create an offline (render-mode) Cacophony wired to the `node-web-audio-api`
 * backend. Drive it with `await context.startRendering()`.
 *
 * NOTE: this constructs the OfflineAudioContext and `new Cacophony(...)`
 * DIRECTLY rather than going through `Cacophony.createOffline()`, because that
 * static helper does not forward `runtimeOptions` — so the
 * `createAudioWorkletNode` seam would be lost and any worklet-backed effect
 * (reverb, distortion, dynamics, ...) would fail to construct.
 */
export function createOfflineNodeCacophony(options: OfflineNodeCacophonyOptions): OfflineNodeCacophony {
  const context = new OfflineAudioContext({
    numberOfChannels: options.numberOfChannels ?? 2,
    length: options.length,
    sampleRate: options.sampleRate,
  });
  const cacophony = new Cacophony(context as unknown as BaseContext, options.cache, {
    createAudioWorkletNode,
    resolveWorkletUrl,
    logger: options.logger,
    quiet: options.quiet,
  });
  return { cacophony, context };
}

/**
 * Decode an audio file from disk into an `AudioBuffer` — the headless way to
 * load a sound under Node. Pass the result to
 * `cacophony.createSound(buffer, "buffer")`, which sidesteps the browser-only
 * URL / fetch / Cache-API path entirely.
 *
 * Reads the file, slices a correct `ArrayBuffer` view from the Buffer, and
 * awaits `context.decodeAudioData`.
 */
export async function decodeAudioFile(
  context: AudioContext | OfflineAudioContext,
  filePath: string,
): Promise<AudioBuffer> {
  const bytes = await readFile(filePath);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return context.decodeAudioData(arrayBuffer);
}
