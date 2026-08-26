// Single source of truth for the library's AudioWorklet modules.
//
// Each entry pairs the `registerProcessor` name (the string passed to
// `AudioWorkletNode` construction and to `audioWorklet.addModule`) with the
// bundle URL. The URLs are imported with Vite's `?url` suffix; in the library
// build Vite currently inlines each bundle as a base64 `data:` URI (see the
// audit notes — splitting them into sibling files is deferred until a real
// browser smoke test exists). This module has NO logic and NO dependency on
// `cacophony.ts` or `effects.ts`, so all three can import it without a cycle.

import barberpoleBundleUrl from "./bundles/barberpole-bundle.js?url";
import bccEncoderBundleUrl from "./bundles/bcc-encoder-bundle.js?url";
import dattorroReverbBundleUrl from "./bundles/dattorro-reverb-bundle.js?url";
import dynamicsBundleUrl from "./bundles/dynamics-bundle.js?url";
import fdnReverbBundleUrl from "./bundles/fdn-reverb-bundle.js?url";
import frequencyShifterBundleUrl from "./bundles/frequency-shifter-bundle.js?url";
import harmonizerBundleUrl from "./bundles/harmonizer-bundle.js?url";
import loudnessMeterBundleUrl from "./bundles/loudness-meter-bundle.js?url";
import modulatedDelayBundleUrl from "./bundles/modulated-delay-bundle.js?url";
import pcmStreamBundleUrl from "./bundles/pcm-stream-bundle.js?url";
import phaseVocoderBundleUrl from "./bundles/phase-vocoder-bundle.js?url";
import phaserBundleUrl from "./bundles/phaser-bundle.js?url";
import spectralFreezeBundleUrl from "./bundles/spectral-freeze-bundle.js?url";
import stereoToBFormatBundleUrl from "./bundles/stereo-to-bformat-bundle.js?url";
import stereoWidenerBundleUrl from "./bundles/stereo-widener-bundle.js?url";
import tremoloBundleUrl from "./bundles/tremolo-bundle.js?url";
import waveshaperBundleUrl from "./bundles/waveshaper-bundle.js?url";

/**
 * A registrable AudioWorklet module: the processor `name` and the `url` of the
 * bundle that calls `registerProcessor(name, ...)`.
 */
export interface WorkletModule {
  /** The `registerProcessor` name — also the per-context load-dedup key. */
  readonly name: string;
  /** The worklet bundle URL passed to `audioWorklet.addModule`. */
  readonly url: string;
}

/**
 * The library's worklet modules, keyed by a stable identifier. Effects and the
 * pitch-shift path reference these instead of repeating name/url literals.
 */
export const WORKLETS = {
  phaseVocoder: { name: "phase-vocoder", url: phaseVocoderBundleUrl },
  harmonizer: { name: "harmonizer", url: harmonizerBundleUrl },
  spectralFreeze: { name: "spectral-freeze", url: spectralFreezeBundleUrl },
  frequencyShifter: { name: "frequency-shifter", url: frequencyShifterBundleUrl },
  barberpole: { name: "barberpole", url: barberpoleBundleUrl },
  bccEncoder: { name: "bcc-encoder", url: bccEncoderBundleUrl },
  stereoWidener: { name: "stereo-widener", url: stereoWidenerBundleUrl },
  stereoToBFormat: { name: "stereo-to-bformat", url: stereoToBFormatBundleUrl },
  dattorroReverb: { name: "dattorro-reverb", url: dattorroReverbBundleUrl },
  dynamics: { name: "dynamics", url: dynamicsBundleUrl },
  fdnReverb: { name: "fdn-reverb", url: fdnReverbBundleUrl },
  waveshaper: { name: "waveshaper", url: waveshaperBundleUrl },
  modulatedDelay: { name: "modulated-delay", url: modulatedDelayBundleUrl },
  pcmStream: { name: "pcm-stream", url: pcmStreamBundleUrl },
  phaser: { name: "phaser", url: phaserBundleUrl },
  tremolo: { name: "tremolo", url: tremoloBundleUrl },
  loudnessMeter: { name: "loudness-meter", url: loudnessMeterBundleUrl },
} satisfies Record<string, WorkletModule>;

/** Every worklet module, for eager preload (see `Cacophony.loadWorklets`). */
export const ALL_WORKLETS: readonly WorkletModule[] = Object.values(WORKLETS);
