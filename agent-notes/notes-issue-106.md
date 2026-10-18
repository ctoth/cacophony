# Issue 106 working notes

## Current findings

- GitHub issue #106 is open: consolidate playback state into one `PlaybackState` machine on `BasePlayback`.
- Its ordered prerequisites are complete: clone fix #100 and stopped-resume fix #105 are closed and merged on `master`.
- `BasePlayback` currently owns `_playing` and derives `isPlaying` from `_playing` plus `source`.
- `Playback` separately owns `_state`, overrides `isPlaying`, and owns `isPaused`.
- `SynthPlayback` separately owns `_state`, inherits `_playing`, and mutates both fields.
- `MediaStreamPlayback` owns `hasStarted` and mutates inherited `_playing`.
- The issue explicitly requires `_playing` removal, one shared state field, BasePlayback-level transition tests, and no public behavior change beyond the already-merged point fixes.

## Workspace state

- Branch: `agent/issue-106-playback-state`, created from current `master` at `7ba2705`.
- Existing untracked `notes-*.md` files belong to prior work and must be preserved.
- This note must remain untracked and must not be staged, committed, or pushed.
- TDD red: `npm test -- src/basePlayback.test.ts` failed because the shared `isPaused` state view did not exist.
- TDD green: the BasePlayback test passed after moving the single state field and named transitions to `BasePlayback`.
- Local gates passed:
  - targeted playback/synth/media regression set: 175 passed, 1 skipped
  - `npm run lint`
  - `npm run ci:test`: 1,028 passed, 2 skipped, no type errors
  - `npm run build`: exit 0 with the repository's existing non-fatal TS4094 declaration diagnostics
- Commit: `1e32e3a` (`Consolidate playback state`).
- PR: #125, https://github.com/ctoth/cacophony/pull/125
- The PR body contains `Closes #106`.
- First CI run `30485282797` is not green:
  - Node 24 test failed.
  - Node 20 and Node 22 tests were cancelled.
  - Build was skipped.
  - Lint & Format and Type Check passed.
- Base-branch CI run `30484412164` at the PR parent `7ba2705` fails at the same pre-test build step:
  - `rollup.config.js:5` uses `import glob from 'glob'`.
  - The installed `glob` module no longer provides a default export.
- No separate open PR currently owns that base-branch build regression.

## Blocker

- The user explicitly authorized a separate PR to repair the unrelated `glob` regression, merge it, then rebase and finish PR #125.
- No current blocker.

## Next action

- Complete the full local gates for the separate `agent/fix-rollup-glob-import` slice, commit only `package.json`, `package-lock.json`, and `rollup.config.js`, push and open its PR, merge it after green CI, then rebase PR #125 and finish its green-only merge.

## Separate base-CI repair

- Clean `npm ci` reproduced the exact Actions failure locally:
  - `npm run build:worklets`
  - `SyntaxError: The requested module 'glob' does not provide an export named 'default'`
- Root cause:
  - `rollup.config.js` used the old default import and consumed `glob` only as an undeclared transitive dependency.
  - `package-lock.json` now installs `glob@13.0.6`.
- Repair in progress:
  - declare `glob@^13.0.6` as a direct development dependency
  - use the supported `globSync` named export
  - request `{ posix: true }` so the existing slash-based filename extraction remains cross-platform
- Green so far:
  - `npm run build:worklets`
  - `npm run lint`
- Generated bundle changes from the verification run were restored and are not part of the repair slice.
- Repair commit: `7540de7` (`Fix Rollup glob import`).
- Repair PR: #126, https://github.com/ctoth/cacophony/pull/126
- PR #126 passed all six checks: lint/format, type check, Node 20/22/24, and Build.
- PR #126 merged as `83a5fb285cce5cac7b50099270e63a67f94e16d7`.

## Issue 106 after base repair

- `agent/issue-106-playback-state` rebased cleanly onto repaired `origin/master`.
- Post-rebase local gates passed:
  - `npm run lint`
  - `npm run ci:test`: 1,028 passed, 2 skipped, no type errors
  - `npm run build`: exit 0 with the existing non-fatal TS4094 declaration diagnostics
- The build regenerated four tracked bundle artifacts; they are verification byproducts and must be restored before pushing because they are not part of issue #106.
- The generated files were restored and the rebased branch was force-pushed with lease at `decb979`.
- PR #125 passed all six checks: lint/format, type check, Node 20/22/24, and Build.
- The PR body was re-verified to contain `Closes #106`, and the mergeable head SHA was re-verified as `decb979b504b8273f655e73a564bec52bbad9efe`.
- PR #125 merged as `385a61300019c3abaaf51ef3c285bb4ec0b20e79`.
- Issue #106 closed automatically at `2026-07-29T20:11:19Z`.
- Task complete; no blocker or next implementation action remains.
