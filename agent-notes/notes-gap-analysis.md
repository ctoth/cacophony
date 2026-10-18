# Session 3 — strategic gap analysis (2026-08-25)

Task: Q asks "what's this library really missing to be awesome for everything — games, webapps, media players, pro + basics?" This is a ROADMAP/gap review, not a bug hunt (sessions 1+2 in notes-deep-review.md covered bugs; all filed waves merged, now at 0.30.4).

## VERIFIED so far
- notes-deep-review.md read in full — two prior review sessions, issues #98–#145 filed and merged.
- Open issues (gh, VERIFIED): 169 typed errors, 167 emitter unification, 166 logger/no-console, 104 stereoPan/HRTF, 57 streaming tracker, 45 param automation API, 43 MIDI, 41 coverage.
- README read in full (0.30.4): buffer/html/streaming tiers, WebCodecs+hls.js streaming, PCM push source, buses/sends, per-source effect recipes, 5 paper-backed advanced effects, FOA decode, IRs, format fallback, autoplay unlock, events, caching, 3D/HRTF.
- Dirs listed: src/cli (render/live/repl/wav/loudness — Node CLI!), src/meters (LUFS loudness + true peak), src/processors (phase vocoder, OLA, harmonizer, Dattorro + FDN reverbs, dynamics, tremolo, phaser, modulated delay, waveshaper, barberpole, freq shifter, spectral freeze, stereo widener, stereo-to-bformat, bcc encoder, timestretch, pcm-stream), src/spatial (foa-encode).
- package.json: exports "." + "./node", bin/cacophony.mjs CLI, biome, playwright browser tests.
- Greps (VERIFIED absent from src/cacophony.ts + relevant files): NO audio sprites, NO scheduled play-at-time (PlayOptions = fades only), NO maxInstances/voice priority, NO MediaSession, NO setSinkId, NO crossfade/playlist, NO recording/MediaRecorder export (browser-side; CLI has wav.ts for Node).
- createCompressor exists (DynamicsEffect), createLoudnessMeter exists.

## Pending
- Explore agent (inventory of full public surface) still running — will confirm exports, factory list, CLI detail, half-wired items.

## Gap thesis forming (to refine when agent returns)
Personas × gaps:
- GAMES: sprites (Howler parity), voice management (max instances/stealing/virtualization), play-at-time + jitter/randomization containers (pitch/vol variance, round-robin), ducking/mixer snapshots, occlusion/reverb-zone helpers, position ramping (zipper noise?), doppler.
- MEDIA PLAYERS: MediaSession API integration, gapless playback + crossfade, playlist abstraction, setSinkId device selection, waveform/peaks extraction, loudness normalization (has LUFS meter — auto-gain missing), EQ preset helper.
- MUSIC/PRO: transport/tempo/beat scheduling (Tone.js territory), param automation timeline (#45 open), ADSR/envelopes/LFO + polyphonic note API on Synth, MIDI (#43 open), recording/export in browser, sidechain routing for dynamics, sample-accurate play(when).
- WEBAPPS/BASICS: docs site with live demos, framework bindings (React hooks), bundle size/tree-shaking story, recipes; README undersells CLI/meters/advanced effects.
- PLATFORM ROBUSTNESS: iOS interruption/devicechange recovery, statechange handling, audio focus.

Blocker: none — waiting on inventory agent, then write final analysis to Q (report only, no fixes/issues unless asked).

## Checkpoint — analysis delivered, now filing issues (Q approved: "open issues for everything that needs doing" + wire BCC)
- Inventory agent returned (full report in transcript): index.ts allowlist, 16 worklets, CLI (play/synth/render/meter/repl), BS.1770-5 meters, FOA encode/decode, Bus.drainTo, Node backend `cacophony/node`, offline rendering. Confirmed dead: bcc-encoder-core.ts (zero importers). Confirmed README gaps: CLI, offline, node backend, encodeMonoToFoaSN3D, metering fns, drainTo, MediaStreamSound. npm desc/keywords weak.
- Delivered gap analysis to Q (6 gaps, top-5 ranking). Q replied: wire BCC + open issues for everything.
- bcc-encoder-core.ts READ in full — complete stateful ERB-partition coherence/pan encoder w/ diagnostics; plan = core tests, OLA shell, algorithm option on createStereoToBFormatNode, worklets.ts+rollup registration.
- Dedupe (VERIFIED gh): open 169,167,166,104,57,45,43,41. NOT filing automation (=#45) or MIDI (=#43); scheduling issue cross-refs #45; synth-voice issue cross-refs #43/#45.
- Heredoc batches FAILED twice ("unexpected EOF matching quote", likely CRLF/heredoc issue in this Git Bash) → switched to Write tool per body file. Bodies 01-05 WRITTEN to scratchpad/issues/ (bcc, docs, scheduling, sprites, voices).
- Still to write: 06 random containers, 07 sidechain/ducking, 08 snapshots, 09 motion smoothing, 10 mediasession, 11 sinkid, 12 playlist/gapless, 13 peaks, 14 normalize LUFS, 15 synth voices, 16 record/export, 17 lifecycle, 18 bundle size, 19 react bindings.
- Then: gh issue create loop (labels: enhancement; 02-docs also documentation), capture URLs, report to Q.
- ALL 19 bodies now WRITTEN to scratchpad/issues/ (01-bcc … 19-react). Next: file via gh, one per body. Titles planned:
  01 Wire up the BCC stereo-to-FOA encoder (bcc-encoder-core.ts is dead code)
  02 Docs: README/npm metadata omit half the library (CLI, offline, Node, metering, drainTo)
  03 Sample-accurate scheduling: play({at}) + lookahead Scheduler
  04 Audio sprites (atlas + named regions) with CLI generation
  05 Voice management: maxInstances, priority, stealing
  06 Randomized SFX containers: pitch/volume jitter, weighted/no-repeat selection
  07 Sidechain input for DynamicsEffect + bus ducking helper
  08 Mixer snapshots: capture/apply named mix states with ramped transitions
  09 Spatial motion polish: smooth position writes; doppler/occlusion helpers
  10 Media Session API integration
  11 Browser output device selection (AudioContext.setSinkId)
  12 Playlist with prefetch, gapless transitions, and crossfade
  13 Waveform peak extraction for seek-bar UIs
  14 Loudness normalization: normalize sounds to target LUFS with true-peak cap
  15 Synth voice architecture: ADSR, noteOn/noteOff, polyphony, LFO, sampler
  16 In-browser recording and export (bus capture, WAV export)
  17 Audio session lifecycle: interruptions, devicechange, statechange recovery
  18 Bundle size: measure, tree-shake, consider lazy cacophony/effects subpath
  19 React bindings package (separate repo/package decision included)
Blocker: none. After filing: report URLs to Q.

## FILED — all 19 (VERIFIED: every URL is raw gh output this session)
#193 BCC encoder wire-up · #194 docs/npm metadata · #195 scheduling clock · #196 sprites · #197 voice management · #198 random containers · #199 sidechain/ducking · #200 mixer snapshots · #201 motion smoothing · #202 Media Session · #203 setSinkId · #204 playlist/gapless/crossfade · #205 peaks · #206 LUFS normalize · #207 synth voices · #208 recording/export · #209 session lifecycle · #210 bundle size · #211 react bindings.
Cross-ref comments posted (gh output VERIFIED): 204→195/202/206, 203↔209, 207→197, 196→195, 45→195.
Dedupe honored: no new issues for automation (#45) or MIDI (#43).
Status: DONE. Nothing pending.

## Session 3b — grooming pass (Q: "groom 'em all against the actual code more?")
- Plan: 7 parallel general-purpose agents, each grooming a cluster against source, writing groomed bodies to scratchpad/groomed/{N}.md. Clusters: (193,201) spatial · (195,196,204) scheduling/sprites/playlist · (197,198,200) voices/random/snapshots · (199,207) sidechain/synth · (202,203,209) platform · (205,206,208) analysis/export · (194,210,211) docs/bundle/react.
- Agents launched, instructed: verify claims w/ file:line, fix API shapes to real patterns, honest about test-infra limits, do NOT edit issues — files only.
- When all 7 report: review deltas, apply via `gh issue edit N -F scratchpad/groomed/N.md`, report corrections to Q.
- Blocker: waiting on the 7 agents.
- DONE (7/7) platform → groomed/{202,203,209}.md. Key deltas: #202 PlaybackEvents.seek declared but NEVER emitted (prerequisite co-change); scoped to Sound (no playlist yet); seekto must try/catch. #203 standardized-audio-context has NO setSinkId (verified node_modules) → SAC contexts always unsupported; Chromium-native-only; runtime typeof detection; sinkChange event; shared AudioSinkId type from node.ts. #209 autoplayUnlock already handles gesture statechange re-arm; missing = platform-transition events, devicechange, silent auto-resume; iOS "interrupted" state DISARMS gesture listeners (one-line fix); suspendState field already distinguishes user-pause; dedupe hazard (pause() emits + statechange fires).
- APPLIED: all 19 groomed bodies pushed via gh issue edit (OK 193-211, VERIFIED). H1 title lines stripped first.
- Pre-existing bugs surfaced by grooming (recorded inside groomed bodies, NOT separately filed): (a) Playback.stop() never removes from origin.playbacks; (b) PlaybackEvents.seek never emitted; (c) Bus.gain setter doesn't cancel scheduled ramps; (d) autoplayUnlock disarms on iOS interrupted; (e) stale CLI comment cli/index.ts:248. Offered to Q to file separately.
- Status: grooming pass DONE.

## Session 3c — extract inlined bugs to separate issues (Q: "file those separately and link")
- FILED (VERIFIED gh output): #212 playbacks leak · #213 seek never emitted · #214 Bus.gain no cancelScheduledValues · #215 unlock disarms on iOS interrupted · #216 stale CLI comment (bug + good first issue).
- Now de-inlining parents: 197.md + 202.md edited locally (leak→#212, seek→#213). Still to edit: 200.md (→#214, two spots: line ~76 note + implementation notes), 209.md (→#215: item 2 keep description + link, section 4 "belongs with this issue" → replaced by ref, acceptance re-arm test line), 194.md (→#216: line ~38 parenthetical + line ~62 checklist item). Then re-push those 5 via gh issue edit -F.
- De-inlining complete: 194/197/200/202/209 edited locally (leak→#212, seek→#213, gain→#214, interrupted→#215 incl. moving its acceptance test out of #209, CLI comment→#216) and re-pushed via gh issue edit (OK all 5, VERIFIED).
- Session 3c DONE. Open roadmap: #193-#211 groomed; bugs #212-#216 standalone. Nothing pending.
- DONE (6/7) analysis/export → groomed/{205,206,208}.md. Key deltas: #205 pure core takes Float32Array[] channels (timeStretchChannels pattern), home src/waveform-core.ts, CLI peaks like runMeter. #206 signatures confirmed; channel-labeling policy lives only in cli/meter.ts (extract; meter uses sample peak not truePeakDb!); do NOT ride .volume → dedicated normalization GainNode in preplay fanned out like loop(); silence guard, return {gainDb, limited, measured}. #208 encodeWav returns Node Buffer + cli/ not exported → extract browser-safe src/wav-core.ts prerequisite; BaseContext lacks createMediaStreamDestination (one-line addition, MediaRecorder path browser-tests-only); renderToWav ~20 lines over createOffline.
- DONE (5/7) docs/bundle/react → groomed/{194,210,211}.md. Key deltas: #194 all claims verified; real CLI flag/fx lists captured; root index.html is working demo seed; docs/ shipped in tarball; stale-comment bug found (cli/index.ts:248 says --pan deferred but live.ts applies it). #210 measured: ESM 509KB raw/143KB gz, base64 ≈74%; tree-shaking impossible today (no sideEffects, single chunk, cacophony.ts value-imports all effects + ALL_WORKLETS) → factory-lazy-import elevated. #211 SSR-safe imports (no module-scope browser APIs; only constructor AudioContext); on/once return cleanup fns (useSyncExternalStore-ready); gotchas: no timeupdate (rAF poll), Playback.duration throws after cleanup; suggest exporting TypedEventEmitter.
- DONE (4/7) scheduling/sprites/playlist → groomed/{195,196,204}.md. Key deltas: #195 offset/duration moved to #196; fade-anchor problem (fades ramp from now); finite-loop restarts JS-driven so at= guarantees first start only; sample-accuracy tests must use node backend/skipIf (mock can't render). #196 createSound options-object overload needed (positional collision); CLI atlas must be WAV not webm; region loop must use loopStart/loopEnd NOT start() duration arg. #204 'ended' verified all tiers (fires before fadeOut completes); gapless hard-depends #195, crossfade doesn't; prefetch = early createSound, no new cache API.
- DONE (3/7) voices/random/snapshots → groomed/{197,198,200}.md. Key deltas: #197 cap at Sound.preplay (Group bypasses play()); BUG found: Playback.stop() never removes from origin.playbacks (stopped voices occupy slots) → reap stopped first, needs public state getter; no global playback registry → global maxVoices deferred. #198 grow Group, jitter play-then-set, weights in Map (sounds externally mutated), honor #35 with separate _variedIndex, deterministic tests via Math.random spy. #200 Bus has NO fade machinery → add Bus.rampGain; filter param addressing only serializable as (busName, index, param) fragile; master includable (input vs output gain disjoint); pre-existing sharp edge: gain setter doesn't cancel scheduled ramps.
- DONE (2/7) spatial cluster → groomed/193.md, groomed/201.md. Key deltas: #193 OLA hop hard-coded 128 (bcc default hopSize 256 would break smoothingAlpha), replacing upmixer loses its X cue (A/B decision), rollup auto-derives from WORKLETS so shell filename must equal processor name; #201 attribution swapped (pan is setValueAtTime, position is raw .value), listener pos/orientation same defect, doppler lever is playbackRate not detune, occlusion substrate already exists (filters + rampParam), ship tau default 0.
- DONE (1/7) sidechain/synth cluster → groomed/199.md, groomed/207.md. Key deltas: #199 helper must move to Cacophony.duckUnder (addFilter returns bare node, Bus lacks input-index connect + Cacophony ref); fixed-amount ducking deferred (compressor is level-dependent); #207 ADSR needs its own envelopeGain (VolumeMixin volume setter clobbers gain.value), polyphony = note→playback map, sampler = new class over Sound.
