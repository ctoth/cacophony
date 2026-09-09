// Single source of truth for the library's AudioWorklet modules.
//
// Each entry pairs the `registerProcessor` name (the string passed to
// `AudioWorkletNode` construction and to `audioWorklet.addModule`) with the
// lazy bundle URL. Each dynamic `?url` import keeps its base64 payload in a
// separate chunk until that processor is needed. The data URL still works with
// the browser and the Node adapter's URL resolver. This module has no dependency on
// `cacophony.ts` or `effects.ts`, so all three can import it without a cycle.

/** A URL supplied directly or loaded on demand before registration. */
export type WorkletUrl = string | (() => Promise<string>);

/**
 * A registrable AudioWorklet module: the processor `name` and the `url` of the
 * bundle that calls `registerProcessor(name, ...)`.
 */
export interface WorkletModule {
  /** The `registerProcessor` name — also the per-context load-dedup key. */
  readonly name: string;
  /** Resolved before passing the bundle URL to `audioWorklet.addModule`. */
  readonly url: WorkletUrl;
}

/**
 * The library's worklet modules, keyed by a stable identifier. Effects and the
 * pitch-shift path reference these instead of repeating name/url literals.
 */
export const WORKLETS = {
  phaseVocoder: {
    name: "phase-vocoder",
    url: () => import("./bundles/phase-vocoder-bundle.js?url").then((module) => module.default),
  },
  harmonizer: {
    name: "harmonizer",
    url: () => import("./bundles/harmonizer-bundle.js?url").then((module) => module.default),
  },
  spectralFreeze: {
    name: "spectral-freeze",
    url: () => import("./bundles/spectral-freeze-bundle.js?url").then((module) => module.default),
  },
  frequencyShifter: {
    name: "frequency-shifter",
    url: () => import("./bundles/frequency-shifter-bundle.js?url").then((module) => module.default),
  },
  barberpole: {
    name: "barberpole",
    url: () => import("./bundles/barberpole-bundle.js?url").then((module) => module.default),
  },
  bccEncoder: {
    name: "bcc-encoder",
    url: () => import("./bundles/bcc-encoder-bundle.js?url").then((module) => module.default),
  },
  stereoWidener: {
    name: "stereo-widener",
    url: () => import("./bundles/stereo-widener-bundle.js?url").then((module) => module.default),
  },
  stereoToBFormat: {
    name: "stereo-to-bformat",
    url: () => import("./bundles/stereo-to-bformat-bundle.js?url").then((module) => module.default),
  },
  dattorroReverb: {
    name: "dattorro-reverb",
    url: () => import("./bundles/dattorro-reverb-bundle.js?url").then((module) => module.default),
  },
  dynamics: {
    name: "dynamics",
    url: () => import("./bundles/dynamics-bundle.js?url").then((module) => module.default),
  },
  fdnReverb: {
    name: "fdn-reverb",
    url: () => import("./bundles/fdn-reverb-bundle.js?url").then((module) => module.default),
  },
  waveshaper: {
    name: "waveshaper",
    url: () => import("./bundles/waveshaper-bundle.js?url").then((module) => module.default),
  },
  modulatedDelay: {
    name: "modulated-delay",
    url: () => import("./bundles/modulated-delay-bundle.js?url").then((module) => module.default),
  },
  pcmStream: {
    name: "pcm-stream",
    url: () => import("./bundles/pcm-stream-bundle.js?url").then((module) => module.default),
  },
  phaser: { name: "phaser", url: () => import("./bundles/phaser-bundle.js?url").then((module) => module.default) },
  tremolo: { name: "tremolo", url: () => import("./bundles/tremolo-bundle.js?url").then((module) => module.default) },
  loudnessMeter: {
    name: "loudness-meter",
    url: () => import("./bundles/loudness-meter-bundle.js?url").then((module) => module.default),
  },
} satisfies Record<string, WorkletModule>;

/** Every worklet module, for eager preload (see `Cacophony.loadWorklets`). */
export const ALL_WORKLETS: readonly WorkletModule[] = /* @__PURE__ */ Object.values(WORKLETS);
