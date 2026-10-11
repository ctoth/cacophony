# Issue 114 working notes

## Current state

- Issue `ctoth/cacophony#114` is open and contains four acceptance items:
  media double-fetch, empty `SynthGroup.detune`, offline fade promise timing,
  and replay after terminal media-stream stop.
- `master` matches `origin/master` after `git fetch origin`.
- The tracked worktree is clean. Existing untracked `notes-*.md` files are
  user-owned and must remain unstaged.
- GitHub CLI 2.87.3 is installed and authenticated as `ctoth`.
- Branch `agent/issue-114-paper-cuts` was created from current `master`.
- Targeted pre-change baseline: 98 tests passed across the four affected
  suites.
- Red phase: the four new public-flow assertions each failed for the expected
  defect.
- Production changes are now present for all four items. The targeted rerun is
  green at 101 passed.
- Full gates passed: lint, 1,032 passed / 2 skipped with no type errors, and
  build. The build retained the repository's existing TS4094 and TypeDoc
  warnings.
- Commit `6b1574eab532bc1f3a7d4a89c49be0a93e929fbe` was pushed.
- PR `#128` included `Closes #114`; all six required checks passed and the PR
  merged as `dd90f021b075e6b4d2a570468d96b449959b6ed3`.
- GitHub confirms issue `#114` is closed as completed.

## Findings

- `Cacophony.createMediaSound()` creates and loads a probe `Audio`, then
  `Sound.preplay()` creates a second `Audio` for the same URL. The defect is
  present. `src/cacophony.test.ts` already has
  `createControllableAudioElement()`, which is appropriate for a public-flow
  regression test.
- `SynthGroup.detune` currently casts `this.synths[0]?.detune` to `number`, so
  an empty group returns `undefined`. The defect is present.
- `VolumeMixin.fadeTo()` schedules gain automation on audio-context time but
  always completes through `setTimeout(duration)`. Offline contexts are
  identifiable by `startRendering`; the defect is present.
- `MediaStreamPlayback.stop()` stops tracks by default, then a later `play()`
  re-enables them and marks playback active without checking `readyState`.
  The replay trap is present.
- The media reuse test proves only two `Audio` constructions after both
  `preplay()` calls and verifies both prepared elements are handed to
  `createMediaElementSource`.
- Repository gates from current `package.json` and prior verified work are
  `npm run lint`, `npm run ci:test`, and `npm run build`.

## Blocker

- None.

## Next action

- None. Issue 114 is resolved, merged, and closed.
