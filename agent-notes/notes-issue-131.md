# Issue 131 working notes

## Current findings

- GitHub issue #131 is open: "Add WebCodecs pull adapter: fetch → AudioDecoder → PCM stream source".
- Its prerequisite, issue #130, is closed by merged PR #134, and `master` contains the public `PcmStreamSound` AudioWorklet ring-buffer source.
- The acceptance surface requires public routing/effects/metering, range-backed seeking, honest live/unseekable capabilities, abort teardown, a media-element fallback without WebCodecs, and README documentation.
- Existing graph assertions are `expectReachable`, `expectNotReachable`, `expectPath`, and `graphSnapshot` in `src/setupTests.ts`.
- Existing local gates are `npm run lint`, `npm run ci:test`, and `npm run build`.
- `createStream()` currently always returns a media-element-backed `Sound`; no WebCodecs/demux adapter exists.

## Observations

- `PcmStreamSound` already inherits `RoutableSource`, so feeding decoded PCM into it preserves public bus routing, panning, filters, and metering without a parallel routing adapter.
- Mediabunny provides URL range reads, MP3/AAC/Ogg/FLAC/WAV demuxing, WebCodecs-backed `AudioSampleSink`, seeking by sample timestamp, live metadata, and `Input.dispose()` cancellation.
- Mediabunny `AudioSample` exposes interleaved `f32` copy and must be closed promptly.
- The decoded sample rate can differ from the AudioContext sample rate, so the adapter must resample before `PcmStreamSound.write()`.
- `UrlSource` controls request abort internally; the supplied `AbortSignal` must call `Input.dispose()` as well as cleaning up the PCM source.

## State

- Branch: `agent/webcodecs-pull-stream`, created from an up-to-date `master` (`HEAD...upstream` was `0 0`).
- Tracked worktree was clean before starting.
- Pre-existing untracked `notes-*.md` files are unrelated and must remain untouched.
- `mediabunny@^1.51.0` has been added to `package.json` and `package-lock.json` as the demux/WebCodecs dependency.
- A new public-path acceptance suite, `src/webCodecsStream.test.ts`, was run red first: all five cases failed against the media-element-only implementation.
- The pull implementation now composes `WebCodecsPullAdapter` over `PcmStreamSound`, reusing its routing, filters, panning, metering, backpressure, and teardown.
- `createStream()` selects the WebCodecs path when `AudioDecoder` exists and the primary track is decodable; otherwise it returns the existing media-element `Sound`.
- Both tiers expose `streamCapabilities` with `transport`, `seekable`, `live`, and `duration`.
- The adapter reopens and disposes its decoder input for range-backed seeks, maps live/unknown duration to `Infinity`, feeds interleaved float PCM, and disposes reads/decoders on abort without logging.
- The exact demux format list is MP3, ADTS AAC, MP4/M4A AAC, Ogg, FLAC, and WAVE. HLS is deliberately excluded because issue #131 names it as a non-goal.
- The targeted acceptance suite now passes: 5 tests passed.
- The broader stream/PCM/routing/meter suite passes: 6 files and 96 tests.
- The previous issue's documentation test was stale because it required `cacophony.ts` to describe `createStream()` as media-element-backed. It now requires both the WebCodecs pull path and the retained media fallback.
- Full `npm run ci:test` passes: 71 files, 1049 passed, 2 skipped, no type errors.
- `npm run lint` passes.
- `npm run build` succeeds. It still reports the known TS4094 declaration warnings and TypeDoc warnings; one TypeDoc warning names the new internal `PcmStreamPullSource`.
- Build rewrote four unrelated phase-vocoder/timestretch bundle artifacts; those exact generated files were restored and are no longer in the issue diff.
- `npm audit --omit=dev` reports zero production vulnerabilities.
- Commit `e4ba859` ("Add WebCodecs URL streaming") contains the single kept issue slice.
- PR #137 was opened ready for review with the exact closing line `Closes #131`.
- Live CI passed all six checks: Lint & Format, Type Check, Test (20), Test (22), Test (24), and Build.
- PR #137 merged at 2026-07-30T05:52:58Z with merge commit `b7074cc8a145eaf1fefc19a4c4dd80e460472dfc`.
- GitHub confirms issue #131 closed at 2026-07-30T05:52:59Z by PR #137.

## Blocker

- None currently.

## Next action

- None. The requested issue, PR, green-check watch, merge, and closing linkage are complete.
