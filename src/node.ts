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
 * `node-web-audio-api` is an OPTIONAL dependency (declared under
 * `optionalDependencies`). It is loaded on demand — the first time a Node
 * backend is constructed — so importing this module for its types, or using the
 * browser build, never pulls in the native package. When it is genuinely
 * missing at call time, {@link loadBackend} throws a directed install hint
 * rather than letting a bare module-resolution error surface.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AudioContext, OfflineAudioContext } from "node-web-audio-api";
import type { ICache } from "./cache";
import { Cacophony, type RuntimeOptions } from "./cacophony";
import type { BaseContext } from "./context";
import type { CacophonyLogger } from "./logger";

/** The shape of the lazily-loaded `node-web-audio-api` module namespace. */
type NodeBackend = typeof import("node-web-audio-api");

/** Memoized backend load — resolves once, retries only after a failed load. */
let backendPromise: Promise<NodeBackend> | undefined;

/**
 * Load the `node-web-audio-api` backend on demand. The dynamic `import()` keeps
 * the native package out of any code path that does not actually construct a
 * Node context (browser build, type-only imports). A failed load is converted
 * into an actionable install hint and the cache is cleared so a later call can
 * retry once the user installs the package.
 */
function loadBackend(): Promise<NodeBackend> {
  backendPromise ??= import("node-web-audio-api").catch((cause) => {
    backendPromise = undefined;
    throw new Error(
      "cacophony/node requires the optional 'node-web-audio-api' backend, which is not installed.\n" +
        "Install it to use the Node / offline audio backend:\n\n" +
        "    npm install node-web-audio-api\n",
      { cause },
    );
  });
  return backendPromise;
}

/**
 * Build the worklet-node factory Cacophony needs on the Node backend, where
 * `AudioWorkletNode` is not a global. Bridges to `node-web-audio-api`'s
 * constructor, captured from the lazily-loaded backend.
 */
function makeCreateAudioWorkletNode(
  Ctor: NodeBackend["AudioWorkletNode"],
): NonNullable<RuntimeOptions["createAudioWorkletNode"]> {
  return (context, name, options) => new Ctor(context as ConstructorParameters<typeof Ctor>[0], name, options);
}

/** Per-source-URL memoized `blob:` URL of a worklet bundle (built on first use). */
const workletBlobUrlBySourceUrl = new Map<string, string>();

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
  const isDataUrl = url.startsWith("data:");
  const isSourceBundleUrl = url.startsWith("/src/bundles/");
  if (!isDataUrl && !isSourceBundleUrl) {
    return url;
  }
  const cached = workletBlobUrlBySourceUrl.get(url);
  if (cached) {
    return cached;
  }
  // Published builds provide an inlined data URL. Vite source/test execution
  // exposes the same bundle as a root-relative /src/bundles URL; read that
  // repository file directly so the Node offline backend exercises the same
  // worklet without requiring a pre-built package.
  const code = isDataUrl
    ? await (await fetch(url)).text()
    : await readFile(resolve(process.cwd(), url.slice(1)), "utf8");
  const blobUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  workletBlobUrlBySourceUrl.set(url, blobUrl);
  return blobUrl;
};

/** Shared options for routing Cacophony's host-side diagnostics. */
interface LoggingOptions {
  /** Optional logger for the `[cacophony/worklet]` diagnostics. */
  logger?: CacophonyLogger;
  /** Suppress all host-side diagnostics (ignored when `logger` is set). */
  quiet?: boolean;
}

/**
 * An `AudioContext` output sink id: a device id string, or `{ type: "none" }`
 * for a null sink (headless / no audio device). Mirrors the Audio Output
 * Devices API `sinkId`, which `node-web-audio-api` honors at runtime.
 */
export type NodeAudioSinkId = string | { type: "none" };

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
  /**
   * Output sink for the constructed `AudioContext` (ignored when `context` is
   * supplied). Pass `{ type: "none" }` for a null sink in environments with no
   * audio device (CI, containers) — otherwise the backend crashes with
   * `DeviceNotAvailable`. Omit for the system default output device. (Typed
   * locally: `node-web-audio-api` accepts this per the Audio Output Devices API,
   * but the DOM lib this project targets does not yet model it.)
   */
  sinkId?: NodeAudioSinkId;
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
export async function createNodeCacophony(options: NodeCacophonyOptions = {}): Promise<NodeCacophony> {
  const backend = await loadBackend();
  // `sinkId` is cast in because the DOM lib's AudioContextOptions does not model
  // it yet; node-web-audio-api reads it at runtime (undefined -> default device).
  const context =
    options.context ??
    new backend.AudioContext({ latencyHint: "playback", sinkId: options.sinkId } as AudioContextOptions);
  const cacophony = new Cacophony(context as unknown as BaseContext, options.cache, {
    createAudioWorkletNode: makeCreateAudioWorkletNode(backend.AudioWorkletNode),
    resolveWorkletUrl,
    logger: options.logger,
    quiet: options.quiet,
  });
  return { cacophony, context };
}

/**
 * Create an offline (render-mode) Cacophony wired to the `node-web-audio-api`
 * backend. Drive it with `await context.startRendering()`.
 */
export async function createOfflineNodeCacophony(options: OfflineNodeCacophonyOptions): Promise<OfflineNodeCacophony> {
  const backend = await loadBackend();
  const context = new backend.OfflineAudioContext({
    numberOfChannels: options.numberOfChannels ?? 2,
    length: options.length,
    sampleRate: options.sampleRate,
  });
  const cacophony = Cacophony.createOffline(
    {
      numberOfChannels: options.numberOfChannels ?? 2,
      length: options.length,
      sampleRate: options.sampleRate,
      context: context as unknown as BaseContext & { startRendering(): Promise<AudioBuffer> },
    },
    options.cache,
    {
      createAudioWorkletNode: makeCreateAudioWorkletNode(backend.AudioWorkletNode),
      resolveWorkletUrl,
      logger: options.logger,
      quiet: options.quiet,
    },
  );
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
