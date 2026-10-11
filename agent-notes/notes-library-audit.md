# Cacophony library audit — findings (2026-06-03)

## STATUS: Phase-1 cleanup IN PROGRESS = delete worklet/effect loading duplication.
User correction (important): do NOT keep duplicate methods just because my own tests/internal
callers use them — tests serve the code. DELETE the method pairs outright; rewrite the spies.
Scope locked: "Dedup now, split later." Eager `?url` inline (197KB) STAYS this PR.

## LOCKED DESIGN for the dedup
NEW FILE `src/worklets.ts`: the 10 `?url` imports + a plain `WORKLETS` map of `{key:{name,url}}`
  (single source of truth). No logic, no option types — importable by both cacophony.ts & effects.ts
  & playback.ts with no circular dep.

`effects.ts`:
- DELETE 7 `*Host` interfaces (ReverbHost, DynamicsHost, FdnReverbHost, WaveshaperHost,
  ModulatedDelayHost, PhaserHost, TremoloHost) -> replace with ONE `WorkletEffectHost`
  { buildWorkletEffect(worklet, parameterData, context?): Promise<AudioWorkletNode> }.
- ADD generic `WorkletEffect<O>` base implementing CacophonyEffect; build() resolves
  parameterData (via optional per-subclass toParameterData) then calls host.buildWorkletEffect.
- The 7 named effect classes (ReverbEffect, DynamicsEffect, FdnReverbEffect, WaveshaperEffect,
  ModulatedDelayEffect, PhaserEffect, TremoloEffect) become ~3-line subclasses. Names + option
  types PRESERVED (real exported surface). Keep resolveModeIndex + the 3 mode tables in effects.ts.
- FoaDecoder + FoaDecoderHost UNTOUCHED (not a worklet; different contract). BiquadEffect/ShareEffect
  untouched.

`cacophony.ts`:
- DELETE 16 methods: load/createNode pairs for DattorroReverb, Dynamics, FdnReverb, Waveshaper,
  ModulatedDelay, Phaser, Tremolo, LoudnessMeter.
- DELETE loadPhaseVocoder + createPhaseVocoderNode; playback.ts switches to buildWorkletEffect.
- ADD `buildWorkletEffect(worklet, parameterData, context?)` = loadAudioWorkletModule then
  createWorkletNode. Implements WorkletEffectHost.
- KEEP generics loadAudioWorkletModule, createWorkletNode, createAudioWorkletNode, loadFoaHrir,
  createStereoToBFormatNode + loadStereoToBFormatWorklet (unique node, not boilerplate).
- REWRITE loadWorklets() to iterate WORKLETS via loadAudioWorkletModule.
- MOVE the 10 `?url` imports out to worklets.ts.

`playback.ts`: createPhaseVocoderNode(undefined, ctx) -> buildWorkletEffect(WORKLETS.phaseVocoder, {}, ctx).

TESTS to rewrite (spies target deleted methods -> retarget new seam buildWorkletEffect):
- effects.test.ts (loadDattorroReverb/createDattorroReverbNode + idempotency)
- dynamics-effect.test.ts, fdn-reverb-effect.test.ts, waveshaper-effect.test.ts,
  modulated-delay-effect.test.ts, phaser-effect.test.ts, tremolo-effect.test.ts
- pitch-shift-resurrection.test.ts (createPhaseVocoderNode -> buildWorkletEffect)
- cacophony.test.ts:478,770 (loadPhaseVocoder spy -> assert via buildWorkletEffect/loadWorklets)
Param-translation tests (waveshaper.shape, tremolo.shape, modulated-delay.interpolation) MUST be
preserved — assert buildWorkletEffect called with correct {parameterData} after translation.

## SPIKE (done, dir emptied): Vite lib mode base64-inlines ALL statically-recognizable assets
regardless of assetsInlineLimit/external. ONLY opaque `new URL(path, varBase)` splits (30KB->185B).
CJS auto-shimmed. TRADEOFF: split => consumer must serve dist/bundles/ => runtime 404 invisible to
mocked suite => needs real-browser test. That's why split is deferred.

## RESEARCH (3 bg agents running): how webland solves ship-satellite-asset-by-URL.
Reports -> docs/reports/{bundler-asset-url-patterns,configurable-asset-path-libs,inline-vs-dual-build-strategies}.md
Synthesize when they land.

## COMMIT/PR STATE: branch refactor/worklet-loading-registry, 1 commit 9d9f9a3 (src only,
## verified no docs/reports in it). User said DO NOT commit the research reports — docs/ is
## gitignored anyway so they're safe-on-disk local reference, never staged. Pushing + opening PR now.

## REFACTOR COMPLETE & VERIFIED (self-run): typecheck clean, 926/926 pass (52 files).
## Net source -247 LOC (126+/373-). Test diff audited: 0 tests dropped, 0 weakened assertions.
## Deliverable: descriptor registry (worklets.ts) is single source of truth; 1 buildWorkletEffect
## seam; 7 effect classes -> WorkletEffect<O> subclasses; 7 *Host ifaces -> 1. Public surface intact.
## NOT YET COMMITTED. Eager ?url inline (197KB) unchanged this PR (split deferred).

## PROGRESS [src edits COMPLETE, tests next]:
- cacophony.ts: deleted phase-vocoder..loudness pair block (sed 491,698d). Patched
  createStereoToBFormatNode -> WORKLETS.stereoToBFormat; createLoudnessMeter -> loadAudioWorkletModule
  + createWorkletNode w/ WORKLETS.loudnessMeter. No orphaned *ProcessorWorkletUrl refs remain.
- playback.ts: createPhaseVocoderNode -> buildWorkletEffect(WORKLETS.phaseVocoder,{},ctx); added
  `import {WORKLETS} from "./worklets"`.
- NEXT: run `npm run typecheck` to surface breakage, then fix 8 test files' spies, then `npm test`.
- POSSIBLE TYPECHECK ISSUES TO WATCH: (1) effects.ts may still import unused CacophonyEffect/
  AudioWorkletNode? CacophonyEffect still used by Biquad/Share/FoaDecoder? FoaDecoder is separate.
  Check unused imports. (2) `override` keyword needs noImplicitOverride-compatible (fine). (3)
  abstract WorkletEffect protected constructor + subclass super() OK. (4) WorkletModule import in
  cacophony used. (5) ALL_WORKLETS used in loadWorklets.

## PROGRESS (refactor, live) [updated]:
- effects.ts: ALL 7 classes converted to WorkletEffect<O> subclasses. DONE.
- worklets.ts: DONE.
- cacophony.ts imports: 10 ?url imports removed; added `import {ALL_WORKLETS,WORKLETS,type WorkletModule} from "./worklets"`. DONE.
- cacophony.ts loadWorklets: rewritten to loop ALL_WORKLETS. loadStereoToBFormatWorklet -> WORKLETS.stereoToBFormat.
  buildWorkletEffect(worklet,parameterData,ctx) ADDED (load then createWorkletNode {parameterData}). DONE.
- NEXT EDIT (in progress): DELETE the phase-vocoder..loudness method block (old lines ~474-680):
  loadPhaseVocoder/createPhaseVocoderNode, load/createNode pairs for Dattorro/Dynamics/Fdn/Waveshaper/
  ModulatedDelay/Phaser/Tremolo/Loudness. Replace whole block with nothing.
- THEN cacophony.ts: createStereoToBFormatNode body url -> WORKLETS.stereoToBFormat; createLoudnessMeter
  (calls loadLoudnessMeter+createLoudnessMeterNode) -> loadAudioWorkletModule + createWorkletNode w/
  WORKLETS.loudnessMeter and {numberOfInputs:1,numberOfOutputs:1}.
- THEN playback.ts: createPhaseVocoderNode(undefined,ctx) -> buildWorkletEffect(WORKLETS.phaseVocoder,{},ctx).
- THEN tests (8 files) retarget spies to buildWorkletEffect (or loadAudioWorkletModule for loadWorklets test).
- THEN npm run typecheck && npm test && npm run lint:fix.
- ALL 3 research agents DONE -> docs/reports/*.md. Key: Vite docs CONFIRM lib mode always inlines
  (assetsInlineLimit ignored). Tone.js inlines worklet as BLOB URL in prod (zero files). locateFile/
  workerSrc is the universal override pattern; ffmpeg/tesseract default to CDN (supply-chain risk).
  => reshapes "split later": blob-inline-by-default + setWorkletURL override is the real best practice.

## (orig progress below) PROGRESS (refactor, live):
- DONE: src/worklets.ts created (WORKLETS map + ALL_WORKLETS).
- DONE effects.ts: 7 *Host ifaces -> 1 WorkletEffectHost; added abstract WorkletEffect<O> base
  (build() -> host.buildWorkletEffect(worklet, toParameterData(options), ctx)); converted
  ReverbEffect, DynamicsEffect, FdnReverbEffect, WaveshaperEffect(override toParameterData),
  ModulatedDelayEffect(override), PhaserEffect to subclasses.
- TODO effects.ts: convert TremoloEffect (override toParameterData for shape). Check no leftover
  refs to old Host types / unused imports (CacophonyEffect still used by Biquad/Share/Foa; keep).
- TODO cacophony.ts: delete 16 load/createNode methods + loadPhaseVocoder/createPhaseVocoderNode;
  add buildWorkletEffect; rewrite loadWorklets to iterate ALL_WORKLETS; remove 10 ?url imports
  (now in worklets.ts); keep foaHrirUrl import.
- TODO playback.ts: createPhaseVocoderNode -> buildWorkletEffect(WORKLETS.phaseVocoder,{},ctx).
- TODO tests: retarget ~80 spies (8 files) to buildWorkletEffect seam.
- THEN: npm run typecheck + npm test. Research agent 2 (configurable-asset-path) DONE; 1 & 3 pending.

## Good (keep): tests>src LOC, explicit index.ts allowlist, 0 @ts-ignore, paper-faithful DSP,
FinalizationRegistry cleanup. notes-modulation-effects-progress.md = pre-existing untracked, not mine.
