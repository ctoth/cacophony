# Deep review notes — cacophony (2026-07-29)

Task: Q asked for a deep library review: (1) issues/bugs, (2) almost-beautiful-but-unwired things, (3) big-picture improvements. Deliverable is findings in my final message — no fixes unless asked.

## VERIFIED (files fully Read this session)
- ~/.claude/failures/2026-07-28-measured-harm-to-q.md — read first, per rule.
- src/cacophony.ts (all 1670 lines, two Read calls)
- src/sound.ts (756 lines)
- src/playback.ts (865 lines)
- src/basePlayback.ts (85 lines)
- src/container.ts (272 lines)
- src/bus.ts (649 lines)
- src/filters.ts (64 lines)
- src/volumeMixin.ts (189 lines)
- src/pannerMixin.ts (242 lines)

## Candidate findings so far (INFERRED from reading; not yet cross-checked against tests/other files)
1. `BasePlayback.isPlaying` reads `this._playing` (basePlayback.ts:29-34) but `Playback` overrides `isPlaying` via `_state`; `_playing` on BasePlayback appears to be dead/desynced state. Need to check SynthPlayback use.
2. `Cacophony.muted` is `gain.value === 0` (cacophony.ts:1598) — setting volume = 0 makes `muted` true; then `set volume` while "muted" stashes to prevVolume and does NOT apply → user who sets volume 0 then volume 0.5 gets nothing until unmute(). Verify by reading tests.
3. `Playback.play()` on `_state === "stopped"` with media element restarts, but for buffer sources state "stopped": `recreateSource` + start — appears handled. Check `stop()` throws for "unplayed" — no, early-returns.
4. `Sound.stop()` truncates `_holdings` arrays entirely (sound.ts:423-425) — but holdings arrays are shared across ALL playbacks of the sound; stop() wipes cleanup holdings for the FinalizationRegistry while super.stop() also cleans up playbacks. Probably fine but registry then can't disconnect if... actually cleanup happens via p.cleanup(). OK-ish.
5. `container.stereoPan` setter stores then fans out; PannerMixin's stereoPan setter throws when panType is HRTF — Sound with HRTF panType + set stereoPan → throws from playback fan-out mid-iteration? Container doesn't guard panType. Check.
6. `volumeMixin.fadeTo` resolves via setTimeout(duration) — wall-clock vs audio-context time; offline contexts (startRendering) render faster than wall clock → fades in offline rendering scheduled on context time OK, but promise waits real ms. Minor.
7. `Sound.resume()` calls playback.play() on ALL playbacks including "stopped"/"unplayed" ones; play() on stopped buffer source restarts from offset 0 — semantics? check tests.
8. `Playback.clone()` for media element: `clone._state = this._state` set BEFORE `if playing → clone.play()`; play() early-returns when `_state === "playing"` → clone of a playing playback never actually starts. Check: clone.play() with _state already "playing" returns [this] without starting. LIKELY REAL BUG. Verify against tests.
9. `container.play()` → `p.play()` then Sound.play wraps preplay+play with listeners; Group uses container path. Fine.
10. `Cacophony.setGlobalVolume` emits volumeChange but `set volume` when muted stores prevVolume silently — asymmetry (see #2).
11. `pannerMixin.setPanType` recreates panner but does NOT reconnect source→panner→gain chain; callers (Playback constructor) wire after. `clone.setPanType(panType, this.context)` in Playback.clone is called AFTER constructor already wired panner — switching panType in clone would orphan the wired panner. Check clone(panType override) path: constructor sets origin.panType, then clone.setPanType(newType) creates NEW panner node, but source was connected to OLD panner; new panner never connected to gainNode. LIKELY REAL BUG for clone with panType override.
12. Bus filters: `Sound`-level filters only BiquadFilterNode; bus accepts effects. Sounds can't take CacophonyEffects — asymmetry (big-picture item).

## Checkpoint 2 — additional files fully Read
eventEmitter.ts, synth.ts, synthPlayback.ts, group.ts, synthGroup.ts, oscillatorMixin.ts, cache.ts, effects.ts, mediaStream.ts, microphone.ts, stream.ts.

## New candidate findings (checkpoint 2)
13. **OscillatorMixin discards its Base**: `OscillatorMixin(PannerMixin(VolumeMixin(FilterManager)))` in synthPlayback.ts builds a mixin chain, but oscillatorMixin.ts line 11 does `abstract class OscillatorMixin extends BasePlayback` — the `Base` type parameter is ignored entirely. The composed chain is thrown away; works only because BasePlayback happens to include the same mixins. "Almost beautiful, not wired."
14. **AudioCache statics are cross-instance and cross-context**: `decodedBuffers`, `pendingRequests`, `pendingCallbacks` are static keyed by URL only (cache.ts:215-221). Two Cacophony instances with different sample-rate contexts (e.g. realtime 48k + offline 44.1k) share decoded AudioBuffers → wrong sample rate on the second context. Everywhere else the library is scrupulously per-context (foaHrirCache, impulseResponseCache, worklet registry WeakMaps). Inconsistent discipline.
15. `clearMemoryCache()` on ONE instance nukes static state for all instances (cache.ts:994-1001).
16. MicrophoneStream.play() with no stream: async getUserMedia, returns [] immediately, errors only console.error'd — no event, no promise. Whole microphone.ts predates the event system (no eventEmitter, no state machine, panner hardcoded createPanner, no panType support, stop() doesn't disconnect). Legacy module. Same for stream.ts createStream (fire-and-forget, console.error, 44-byte header hack, comment says 50ms but code adds 20ms).
17. OscillatorMixin.play() calls source.start() unconditionally — restart of started oscillator throws InvalidStateError; SynthPlayback overrides play so mixin play likely dead code (verify).
18. Group.play() bypasses Sound.play() (calls preplay + playback.play directly) → Sound-level "play" events and fadeIn/fadeOut PlayOptions never fire through Group. Sound.play options also unavailable on Group.
19. Group.playOrdered(false): after one full cycle playIndex sticks at sounds.length forever; no reset API.
20. SynthGroup.detune getter `this.synths[0]?.detune as number` → undefined for empty group vs documented defaults elsewhere. Minor.
21. Synth.clone() `overrides.position?.length ? overrides.position : this.position` — cannot override with [0,0,0]... actually [0,0,0].length===3 truthy, fine; but `this.position` getter on stereo synth returns [0,0,0], fine. Non-issue.
22. mediaStream preplay returns singleton playback[0]; stop() (container) cleans up playbacks and empties array — then preplay creates new source from same stream. OK. But stopTracksOnStop default true → stop() permanently kills tracks; play() again silently plays dead stream. Ergonomics trap.
23. stream.ts createStream returns void — no handle, no stop, races nextTime. cacophony.createStream (Sound streaming via media element) is DIFFERENT from stream.ts createStream — stream.ts appears unused by cacophony.ts? Verify index.ts exports.

## Still to read
effects.ts, cache.ts, synth.ts, synthPlayback.ts, oscillatorMixin.ts, group.ts, synthGroup.ts, mediaStream.ts, microphone.ts, stream.ts, context.ts, node.ts, eventEmitter.ts, events.ts, autoplayUnlock.ts, worklets.ts, logger.ts, index.ts, spatial/, meters/, processors/ (skim), cli/, package.json, README.

## Checkpoint 3 — all main library modules now fully Read
index.ts, context.ts, events.ts, autoplayUnlock.ts, worklets.ts, meters/loudness-meter.ts, spatial/foa-encode.ts, node.ts. Greps run: clone tests in playback.test.ts (no coverage of playing-clone or panType-override wiring), stream.ts usage (only its own test), mute tests in cacophony.test.ts (no coverage of volume-0 trap).

## Confirmed findings for report (all from full-file reads this session; NO tests executed)
A. Playback.clone() (playback.ts:810-864): (1) new gainNode never connected to any destination — clone silent; (2) clone._state copied then `if playing → clone.play()` early-returns on _state==="playing" → buffer clone's source never started; (3) clone not pushed to origin.playbacks; (4) panType override after constructor wiring orphans panner (setPanType creates new panner; source connected to old, new never connected to gainNode).
B. Same panType-orphan hazard in any post-construction setPanType (pannerMixin.ts:67-84 does not rewire).
C. Cacophony volume-0 trap (cacophony.ts:1575-1600): muted ≡ gain===0; set volume=0 then volume=x stashes prevVolume and returns — audio stays silent until unmute(). setGlobalVolume bypasses the trap (asymmetry).
D. Container stereoPan/HRTF mismatch (container.ts:204-207 + pannerMixin.ts:108-119): sound.stereoPan on an HRTF sound throws only when live playbacks exist, silently stores otherwise.
E. AudioCache statics keyed by URL only, shared across instances/contexts (cache.ts:215-221); decoded buffers reused across contexts with different sample rates; clearMemoryCache is global (994-1001). Violates the per-context discipline used everywhere else.
F. getMicrophoneStream (cacophony.ts:1612-1615) doesn't pass outputNode to MicrophoneStream → mic bypasses master bus/global volume, despite microphone.ts:141-146 comment saying callers should pass globalGainNode (fix fc84d5c added the seam; the caller never adopted it).
G. stream.ts createStream: unused by library, unexported, fire-and-forget console.error API. Dead/legacy.
H. microphone.ts: legacy design — no events, play() with no stream is async with swallowed errors returning [], hardcoded createPanner (no panType, no threeDOptions), stop() doesn't disconnect source, no cleanup(); predates BasePlayback architecture.
I. OscillatorMixin ignores its Base parameter (oscillatorMixin.ts:11 extends BasePlayback directly); the composed chain in synthPlayback.ts:12 is illusory. Its play() (start() on started oscillator) is dead code shadowed by SynthPlayback.play.
J. Group.play() (group.ts:112-121) bypasses Sound.play() → no Sound "play" event, no PlayOptions fades through groups. Group has no PlayOptions.
K. Group.playOrdered(false) permanently exhausts (playIndex = length, no reset).
L. Sound.resume() (sound.ts:435-438) calls play() on ALL playbacks incl. stopped/unplayed ones → restarts stopped ones from 0. Cacophony.resume ≠ Sound.resume semantics.
M. Cacophony.createOffline (cacophony.ts:398-402) does not forward runtimeOptions — node.ts:188-193 documents having to bypass it. Public API gap.
N. Bus effects vs Sound filters asymmetry: Bus.addFilter accepts CacophonyEffect (async, rich); Sound/Playback only BiquadFilterNode (sync clone at preplay). Effects can't be applied per-sound.
O. createMediaSound (cacophony.ts:779-844) loads metadata on probe Audio element, discards it; preplay creates a fresh Audio → double fetch per html/streaming sound.
P. MediaStreamSound stop() with stopTracksOnStop default true kills tracks permanently; play() again silently plays dead stream (mediaStream.ts:142-160).
Q. VolumeMixin fades resolve on wall-clock setTimeout while ramps are on context time — offline rendering completes faster than the promise resolves (volumeMixin.ts:103-124). Minor.
R. Playback state duality: BasePlayback._playing vs Playback._state vs SynthPlayback maintaining both. _playing never set by Playback.
S. SynthGroup.detune returns undefined on empty group (synthGroup.ts:110-112); others have defaults.

Status: report delivered. Q approved filing issues after dedupe check.

## Issue-filing phase (checkpoint 4)
Dedupe done (VERIFIED via gh issue list --state all, full range is 30-67; issues 1-29 don't exist; read bodies of #35 #41 #44 #57 #58 #59):
- Dropped "delete stream.ts" — open #57/#59 own stream.ts (opposite direction: wire it in).
- Dropped playOrdered exhaustion — closed #35 shows terminal state is intended; only reset() mention folded into Group issue.
- Flagged to Q (not touched): #44 codec fallback looks already implemented by createSoundFromUrlArray (cacophony.ts:956-1023).
- #41 (coverage) cross-referenced from retrofit issue.

FILED so far:
- #98 reachability tooling — https://github.com/ctoth/cacophony/issues/98 (VERIFIED: URL in gh output)

Bodies written to scratchpad, NOT yet filed: i02-retrofit, i03-clone, i04-setpantype, i05-mic-master, i06-mute, i07-stereopan.
Still to write + file: resume-restarts-stopped, state-consolidation, AudioCache statics, createOffline runtimeOptions, Group.play bypass, microphone modernization, OscillatorMixin base, RoutableSource mixin, per-sound effects design, paper-cuts batch.
Labels available: bug, enhancement (VERIFIED via gh label list).
Blocker: none.

## Checkpoint 5 — ALL ISSUES FILED (VERIFIED: every URL below is raw gh issue create output from this session)
- #98  reachability tooling                    https://github.com/ctoth/cacophony/issues/98
- #99  retrofit wiring assertions (enh)        https://github.com/ctoth/cacophony/issues/99
- #100 Playback.clone silent/orphaned (bug)    https://github.com/ctoth/cacophony/issues/100
- #101 setPanType orphans chain (bug)          https://github.com/ctoth/cacophony/issues/101
- #102 mic bypasses master bus (bug)           https://github.com/ctoth/cacophony/issues/102
- #103 mute inferred from gain===0 (bug)       https://github.com/ctoth/cacophony/issues/103
- #104 stereoPan on HRTF sound (bug)           https://github.com/ctoth/cacophony/issues/104
- #105 Sound.resume restarts stopped (bug)     https://github.com/ctoth/cacophony/issues/105
- #106 PlaybackState consolidation (enh)       https://github.com/ctoth/cacophony/issues/106
- #107 AudioCache statics cross-context (bug)  https://github.com/ctoth/cacophony/issues/107
- #108 createOffline runtimeOptions (bug)      https://github.com/ctoth/cacophony/issues/108
- #109 Group.play bypasses Sound.play (bug)    https://github.com/ctoth/cacophony/issues/109
- #110 microphone modernization (enh)          https://github.com/ctoth/cacophony/issues/110
- #111 OscillatorMixin Base/dead play (enh)    https://github.com/ctoth/cacophony/issues/111
- #112 RoutableSource mixin (enh)              https://github.com/ctoth/cacophony/issues/112
- #113 per-sound effects design (enh)          https://github.com/ctoth/cacophony/issues/113
- #114 paper cuts batch (bug)                  https://github.com/ctoth/cacophony/issues/114

Dropped from set (dedupe): delete-stream.ts (owned by open #57/#59), playOrdered exhaustion (intended per closed #35; reset() folded into #109). Flagged, untouched: #44 looks already-implemented by createSoundFromUrlArray.
## Checkpoint 6 — #44 closed with Q-approved comment (VERIFIED: gh output showed comment URL https://github.com/ctoth/cacophony/issues/44#issuecomment-5114273636 and "✓ Closed issue ctoth/cacophony#44")
Selection helper verified implemented (createSoundFromUrlArray, tests at cacophony.test.ts:830+, README:154-181); residual (public probe API, non-buffer fallback) named in the closing comment as fresh-issue material.

Status: done. Nothing pending.

# Session 2 — fresh deep review post-merge-wave (2026-07-30)

Q asked for the same three-part review again. VERIFIED via git log: ~20 PRs merged since yesterday's review (fixes for #98-#114 wave, plus streaming: WebCodecs #137, hls #138, PCM #134, honesty pass #133, mute #139). src/stream.ts DELETED; new modules: routableSource.ts, pcmStream.ts, webCodecsStream.ts, hlsAdapter.ts. Open issues (VERIFIED gh issue list): 113, 110, 104, 102, 59, 57, 45, 43, 41.

## VERIFIED fully Read this session
- ~/.claude/failures/2026-07-28-measured-harm-to-q.md (first, per rule)
- cacophony.ts (all 1833 lines, 2 Reads), sound.ts, playback.ts, basePlayback.ts, routableSource.ts, container.ts, volumeMixin.ts

## Candidate findings so far (INFERRED from reads, not yet test-checked)
1. setGlobalVolume() while muted: changes gain + emits volumeChange but leaves isMuted=true → invariant broken (muted but audible; later unmute() restores stale prevVolume). cacophony.ts:1724-1741.
2. cacophony.volume getter while muted returns 0 (gain value), Howler-style would return prevVolume. Debatable, note only.
3. createStream() hardcodes panType "HRTF" everywhere (cacophony.ts:1145-1169); no panType param on the whole streaming tier.
4. canPlaySource uses `new Audio()` — non-browser (Node backend) → catch → false → createSound(urls[]) always fails "no playable source" on Node. cacophony.ts:1097-1109.
5. getMicrophoneStream still bypasses master bus (known open #102).
6. routableSource._addSend: on outputNode.connect throw → `continue` leaks created sendGain node (minor). routableSource.ts:136-141.
7. Playback.clone() doesn't copy _fadeInConfig/_fadeOutConfig/_pitchFactor — clone loses fades and pitch shift. playback.ts:791-851.
8. Sound.play() options fades applied AFTER playback.play() started — fadeIn races first samples at full volume? fadeIn sets gain 0.0001 then ramps; started synchronously before. Buffer source starts at t=0 context time; gain set same tick — probably inaudible gap. Note only.
9. container.fadeIn/fadeOut don't set _volume; fadeTo does. stopWithFade → fadeOut → _volume unchanged (good). OK.
10. Sound.stop() truncates holdings BEFORE super.stop() — pattern from yesterday, kept.

## Checkpoint 2 — additionally fully Read: pannerMixin, filters, bus, group, synthGroup, synth, synthPlayback, oscillatorMixin, cache, pcmStream, webCodecsStream, hlsAdapter, mediaStream, microphone

More candidate findings (INFERRED):
11. Bus.destroy() has no master guard — cacophony.master.destroy() severs the audible path permanently despite createBus docs saying master "not destroyable". bus.ts:516-550.
12. SynthPlayback never emits "play"/"pause"/"stop"/"resume" playback events (Playback does) — event asymmetry; also no per-playback globalPlay via origin. synthPlayback.ts:40-81.
13. Synth.detune getter returns undefined when unset (cast as number), synth.ts:199-201; SynthGroup now guards ?? 0.
14. Playback.clone() doesn't copy _fadeInConfig/_fadeOutConfig/_pitchFactor/_pitchShiftNode — clone silently loses fade-on-loop + pitch shift. playback.ts:791-851.
15. PcmStreamSound: after "ended" then stop(), state becomes "stopped" and inputEnded reset false → play()/write() permitted again but worklet processor may be terminally ended (need processor check). pcmStream.ts:408-421.
16. WebCodecs StreamingPcmResampler is plain linear-interp — no anti-alias LPF on downsample (e.g. 48k src → 44.1k ctx); acceptable v1, worth doc note. webCodecsStream.ts:308-368.
17. WebCodecsPullAdapter.enqueue: when write() accepts-and-fills (returns false but written=true) it still awaits drain before next chunk — intended backpressure, OK.
18. microphone.ts unchanged legacy (known open #110, #102): play() with no stream still swallows getUserMedia errors via console.error and returns []. Confirmed still true.
19. mediaStream stopTracksOnStop default true still kills tracks permanently on stop(); play() after stop throws only if ALL tracks ended (good improvement — throws now, mediaStream.ts:108-111).
20. cache.ts now instance + per-context WeakMaps (#107 fixed properly). clearMemoryCache resets WeakMaps. LGTM.
21. Group.playRandom→randomSound uses Math.random directly — fine (library, not workflow).
22. RoutableSource._setPrimary registered-source leak nuance: if primary rerouted away while a send to oldTarget exists, registration kept (correct). _addSend leaks a dangling sendGain node if outputNode.connect throws (minor). routableSource.ts:136-145.

## Checkpoint 3 — review COMPLETE. Additionally fully Read: effects.ts, eventEmitter.ts, events.ts, autoplayUnlock.ts, index.ts, context.ts, node.ts, worklets.ts, backend-available.ts, logger.ts, processors/pcm-stream-core.ts.

Resolutions (VERIFIED by reads/greps this session):
- Finding 15 RESOLVED NOT A BUG: PcmStreamEngine.stop() resets inputEnded/endedReported/started — post-end restart is safe (pcm-stream-core.ts:126-133).
- Mute: cacophony.test.ts:189 covers volume-set-while-muted (by design); NO test covers setGlobalVolume-while-muted invariant break → finding 1 stands.
- Playback.clone: tests cover #100/#101 wiring, state, filters; NO coverage of _fadeInConfig/_fadeOutConfig/_pitchFactor loss → finding 14 stands (grep playback.test.ts "clone").
- Bus master destroy: grep "master.destroy" over src → no guard, no test → finding 11 stands.
- index.ts: MicrophoneStream NOT exported (MicrophonePlayback is) though getMicrophoneStream returns it — type unnameable by consumers.
- createMediaSound double-fetch (yesterday's O): FIXED — prepared element now flows into Sound._preparedMediaElement and preplay consumes it.
- effects.ts/eventEmitter/bus chain-diff/cache: read clean, no new findings.

Status: report delivered to Q in final message (three-part: bugs / almost-wired / big-picture). No fixes applied, no issues filed — awaiting Q's direction.

## Checkpoint 4 — #113 design settled + filed (Q approved body text, decided pre-panner, no compat)
- #140 FILED (VERIFIED: gh output https://github.com/ctoth/cacophony/issues/140) — EffectChain extraction (Stage A) + pre-panner adoption in all playbacks (Stage B).
- #113 body REPLACED + retitled (VERIFIED: gh edit output returned issue URL) — Stage C feature spec, depends on #140.
- Body files in scratchpad: issue-effectchain-refactor-body.md, issue-113-new-body.md.
- Remaining unfiled findings from this session's review: setGlobalVolume/mute invariant; master.destroy unguarded; Playback.clone drops fades+pitch; createSound(urls[]) fails on Node backend; paper-cuts batch (addSend leak, Synth.detune undefined, SynthPlayback missing events, createStream panType, MicrophoneStream not exported, resampler doc note). Recommendation given to Q; bodies to be drafted for his review on approval.

## Checkpoint 5 — ALL FIVE FILED (Q: "draft and file"; VERIFIED: every URL below is raw gh output)
- #141 setGlobalVolume/mute invariant (bug)   https://github.com/ctoth/cacophony/issues/141
- #142 master.destroy unguarded (bug)         https://github.com/ctoth/cacophony/issues/142
- #143 clone drops fades+pitch (bug)          https://github.com/ctoth/cacophony/issues/143
- #144 urls[] fallback fails on Node (bug)    https://github.com/ctoth/cacophony/issues/144
- #145 paper cuts II (bug)                    https://github.com/ctoth/cacophony/issues/145
- #144 body explicitly flags the unverified item (node-web-audio-api decode-error shape) as an implementation-time verification step, not a fact.
- Session total: #140 (refactor), #113 rewritten, #141-#145. Review complete, all findings dispositioned. Nothing pending.
