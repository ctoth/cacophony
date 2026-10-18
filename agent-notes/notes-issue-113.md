# Issue 113 handoff

## Goal

Resolve GitHub issue #113 with TDD, reuse the shared source/playback effect-chain helpers, open a PR with `Closes #113`, watch CI, and merge only when green.

## Current state

- Completed and merged. Local checkout is back on `master` at merge commit `92d32da` and matches `origin/master`.
- Feature commit: `0c02fb9` (`Add per-source effect recipes`).
- PR #151: https://github.com/ctoth/cacophony/pull/151
- PR body contains `Closes #113`; issue #113 is verified closed.
- Existing unrelated untracked `notes-*.md` files were preserved.
- Red-first regression run failed 9 new tests because `Sound`, `Synth`, `PcmStreamSound`, `MediaStreamSound`, and playback instances did not expose `addEffect`.
- Focused implementation run is green: 6 files, 126 tests.
- `npm run typecheck` and `npm run lint` pass after the focused implementation.
- Full local gate: 74 test files, 1,078 passed, 1 skipped, no type errors.
- Full build passed with the repository's known TS4094 and TypeDoc warnings; generated bundle churn was restored before commit.
- GitHub CI passed all six checks: Lint & Format, Type Check, Node 20/22/24 tests, and Build.

## Implementation observations

- `RoutableSource` is the common source-level owner for all four requested source types. It now stores `CacophonyEffect` recipes and materializes them through one `_preparePlayback` helper.
- `BasePlayback` owns the pre-panner `EffectChain`; it now builds live effects, returns handles, and delegates parameter automation to that chain.
- `EffectChain` now reserves declaration-order slots so sync effects splice immediately while async effects retain their declared order even when promises resolve out of order.
- Source-level biquads use `BiquadRecipeEffect`, preserving the existing `addFilter` API while creating fresh per-playback nodes and retaining `playback.filters` compatibility.
- Built effect graph disposal remains owned by `EffectChain.destroy()` during playback cleanup.
- README now documents per-source dry effects and the shared wet-send bus pattern.

## Tests added

- Independent effect instances for two playbacks and automation isolation.
- Live `Playback.addEffect` handle and pre-panner topology.
- Async out-of-order build resolution with declaration-order graph assertions.
- Effect graph disposal during cleanup.
- Source recipe removal before future playback.
- Dry per-source chain plus shared wet-send route end to end.
- Pre-panner topology for Synth, PCM stream, and MediaStream sources.

## Blockers

- None currently.

## Next action

None. The requested issue, PR, green-CI watch, merge, and closure verification are complete. Keep this note uncommitted.
