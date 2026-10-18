# Issue 112 work log

## Current findings

- GitHub issue 112 is open and valid against current `origin/master`.
- `Sound` and `Synth` still carry duplicated primary-route, send, drain, and bus-registration state machines.
- `MediaStreamSound` has no `routeTo` method and constructs its playback against `globalGainNode`.
- Existing graph helpers in `src/setupTests.ts` are `expectReachable`, `expectNotReachable`, and `expectPath`.
- The tracked worktree was clean before this task; pre-existing untracked `notes-*.md` files are unrelated and remain untouched.

## Current state

- Branch: `agent/issue-112-routable-source`
- Branch point: current `origin/master` (ahead/behind was `0/0` after fetch).
- Baseline command passed:
  - `npm test -- src/routeTo.test.ts src/mediaStream.test.ts src/bus-drainto.test.ts`
  - 3 files passed, 43 tests passed.
- Added an e2e test in `src/mediaStream.test.ts` through the public `Cacophony` API.
- The test routes a live `MediaStreamSound` to a bus and asserts the bus path is reachable while the master path is not reachable.
- Red phase confirmed:
  - `npm test -- src/mediaStream.test.ts`
  - The new test failed with `TypeError: sound.routeTo is not a function`; the other 10 tests passed.
- Added `src/routableSource.ts` as the issue-authorized shared mixin.
- `Sound`, `Synth`, and `MediaStreamSound` now use that one routing state machine.
- Deleted the duplicated route state/functions from `Sound` and `Synth`.
- Moved the per-playback send map and deterministic send cleanup from `Playback` and `SynthPlayback` into their existing common `BasePlayback`.
- The first implementation test reached the bus, but the test's negative reachability assertion was invalid because new buses route onward to master by default.
- Corrected the e2e setup to disconnect its test bus from master before asserting that the playback cannot reach master.
- Green e2e: `src/mediaStream.test.ts` passed 11/11.
- Green unchanged routing/drain suites: 33/33.
- Green lint/format gate.
- Green full typed suite after implementation: 68 files, 1,029 passed, 2 existing skips, no type errors.
- The first production build exited 0 but added TS4094 declaration diagnostics from an anonymous exported mixin class.
- Replaced the anonymous mixin factory with the named shared `RoutableSource` base over the same existing `PlaybackContainer(FilterManager)` stack.
- The subsequent build exited 0 with only the repository's pre-existing `_activeFade` TS4094 diagnostics; the routing-specific TS4094 diagnostics were eliminated.
- Removed the internal `RoutablePlayback` alias from a protected signature so it does not add a TypeDoc warning.
- Final local gates:
  - `npm run lint` passed.
  - `npm run ci:test` passed: 68 files, 1,029 passed, 2 existing skips, no type errors.
  - `npm run build` exited 0 with 35 existing TypeDoc warnings and only the pre-existing `_activeFade` TS4094 declaration diagnostics.
- Commit: `aa4f1c7fbf29d31dcf8ec8835d5fdc1f942a1fab` (`Extract shared source routing`).
- PR: https://github.com/ctoth/cacophony/pull/127
- PR body contains `Closes #112`.
- All CI checks passed: Lint & Format, Type Check, Test on Node 20/22/24, and Build.
- PR merged at `2026-07-29T22:29:10Z`.
- Merge commit: `afcb1eeb6b9f2d624fb37f162a8764ecf4617bc6`.
- Remote `master` points to the merge commit.
- Issue 112 closed automatically at `2026-07-29T22:29:11Z`.

## Blocker

- None.

## Next action

- None. Issue 112 is resolved, PR 127 is merged, and the issue is closed.
