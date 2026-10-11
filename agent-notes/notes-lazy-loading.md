2026-09-08 checkpoint
- Authorized local tree-shaking and lazy MediaBunny implementation; no publication requested.
- Baseline consumer Cacophony: 1,182,105 bytes / 274,842 gzip; cache-only also retains fft.js.
- Red regressions confirmed eager adapter import and missing lazy worklet URL support. Implemented dynamic adapter and worklet URL loaders; production typecheck passes.
- Four focused files pass; existing Cacophony assertions need updating for lazy URL functions and early abort checks.
- Next: package side-effect audit, consumer bundle gates, cancellation/retry tests, full build and browser/Node verification. Existing unrelated notes preserved.

2026-09-08 checkpoint 2
- Full build passes, including packed declaration consumer and new bundle gates; 35 pre-existing TypeDoc warnings remain.
- Preserved ESM/CJS modules plus sideEffects metadata remove unrelated FFT from leaf imports. Initial gzip: Cacophony 35,962 bytes; AudioCache 4,033; ReverbEffect 342.
- 107 focused tests pass; new tests also pass explicit TypeScript checking. Lazy worklet filenames sanitize Vite ?url for Windows.
- Added built-ESM browser smoke fixture and documented lazy loading; browser pretest now builds dist.
- Next: full Vitest suite, Chromium/Firefox/WebKit smoke, built Node ESM/CJS checks, final diff review. No commit or publication requested.

2026-09-08 verification checkpoint
- Full Vitest gate: 90 files, 1,191 tests passed, no reported type errors; explicit new-test TypeScript check also passes.
- Full browser suite: 10 passed, 5 Windows WebKit capability skips; new built-package lazy reverb smoke passes Chromium and Firefox.
- Built Node ESM distortion render passes; CommonJS import leaves MediaBunny/worklets unloaded and all 17 deferred URLs resolve correctly.
- Packed declarations, consumer bundle gates, scoped Biome and whitespace checks pass; existing TypeDoc warnings unchanged.
- Local implementation complete, with existing factory API retained. Changes and this checkpoint remain uncommitted; unrelated notes untouched.

2026-09-08 delivery authorization
- User authorized PR, green-CI merge, then version commit/tag and CI npm publication for Cacophony before continuing react-client.
- Recommended 0.31.0 for opt-in pre-1.0 packaging and advanced worklet type changes; registry currently 0.30.4.
- Current master and fetched origin/master both d07d65d85dd8a78a3ac10be55e164a344d86fc94; no competing lazy-loading PR exists.
- Release workflow triggers on v* tags, builds before tests, then publishes with npm provenance on Node 24.
- React-client PWA work is inspection only; resume after published Cacophony is available. Preserve unrelated notes.

2026-09-08 release progress
- PR #225 merged normally at e0ea43b65d7c103857c05fba45ed9434cd36636b after all 9 checks passed on d24276a0064b89fb4034c4be714f9983559061e5.
- CI also exposed a pre-existing sprite round-trip fixture requesting an audio device; master run 33597848775 confirmed the same failure. Null-sink fixture correction is included.
- Protected master requires Build even for admins, so npm version minor --no-git-tag-version produced release PR #226 instead of a direct version push.
- #226 head 58d91cf4ff288dd2d687360b3a1779b90e66552e changes only package and lockfile versions to 0.31.0; watcher session 3325 active.
- Next: merge green #226, tag merged master v0.31.0, push exact tag, monitor release.yml and verify npm registry/provenance, then resume react-client PWA changes.

2026-09-08 publication and consumer checkpoint
- #226 merged normally; v0.31.0 tags 665b33251d5c9597943c77a9d71dd2e81a2c92a6. Release workflow 34294502295 succeeded; npm latest is 0.31.0 with SLSA provenance and matching gitHead.
- Resumed prior authorized react-client task in isolated C:/Users/Q/code/react-client-lazy-audio, branch fix/lazy-audio-cache from origin/master f0a4a48d8c976dff9bc49d13bd262ef314326f96.
- Upgraded consumer to published ^0.31.0; module-graph precache filtering excludes optional audio only, preserving initial static dependencies. Added same-origin script runtime cache.
- Consumer build, typecheck, four focused tests pass; production Chromium smoke confirms 18 chunks absent during SW installation, first-use reverb fetch, and offline load in a fresh page.
- Next: wire smoke into consumer CI, full consumer tests, focused lint/diff review, and report completed Cacophony release plus consumer work. Original react-client checkout remains untouched.

2026-09-08 Audiom issue scope checkpoint
- React-client PR128 is open; exact-head CI passed. Cacophony .31 release remains complete.
- Audiom isolated worktree front-end-cacophony-0.31.0; dependency-only commit ff04bacc passes TS,86 audio tests,Next production build and real MP3 Chromium smoke.
- User explicitly changed scope to complete #2158 and use Closes; #2152 headless runtime fixture is absent, so building an independent real audio boundary/fixture without absorbing map runtime extraction.
- Synth core moved to src/modules/audio/Synth.ts with injected context/volume/error output; app wrapper preserves API; first-use queue,cancellation,program replay implemented, existing20 GM tests passed before extraction.
- Next: localization, first-use/failure/cancellation tests, real browser/audio graph gates and before-after report, scoped commits and Audiom PR. No consumer merges authorized.

2026-09-08 Audiom implementation checkpoint
- Production commit371c79b5 follows dependency commitff04bacc: audio core independent of stores, app API preserved, first-use TinySynth queue/cancellation/program replay,11locale spoken errors.
- Full unit suite267files passed(3453pass,13skip); real Chromium MP3,beep,GM first note/sequence,blocked chunk error all pass; translations and typecheck pass; final production build session63516 exited0.
- Audio graph pinned esbuild.25.5: baseline765128min/217898gzip vs119610min/33718gzip; absent #2152 full map fixture explicitly documented, independent real audio fixture added with125000budget and forbidden backends.
- Verification/CI/docs files remain uncommitted; package-lock esbuild relocation expected, incidental fsevents/yaml restored. React128CIgreen; Audiom PR not yet open.
- Next: correct external-report filtering to omit dynamic imports, inspect finished build and asset copy,commit test/docs/CI separately,push Audiom PR with Closes2158,check CI.
