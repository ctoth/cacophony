# Issue 173 progress

## Findings

- The concrete buffer, synth, PCM, and media-stream playbacks duplicated lifecycle state and event blocks.
- PCM and media-stream resume paths emitted `play` but omitted the playback-level `resume` event.
- Existing PCM and media-stream test fixtures reproduce the drift through their public sound APIs.

## TDD evidence

- Red: focused PCM and media-stream tests each failed with `play, pause, play, stop`, missing `resume`.
- Green: 105 focused playback tests passed after the implementation.
- Full local gates passed: `npm run lint`; `npm run ci:test` with 1,125 tests and no type errors; `npm run build` with the repository's existing declaration and TypeDoc warnings.

## Implementation

- Added protected `emitPlayStarted(isResume)`, `emitPaused()`, and `emitStopped()` helpers to `BasePlayback`.
- Migrated buffer, synth, PCM, and media-stream playback lifecycle emissions to those helpers.
- Added the optional owning `cacophony` reference to the shared `PlaybackContainer` interface.
- Added PCM and media-stream resume event regressions.

## Delivery state

- Branch: `agent/issue-173-playback-events`
- Commit: `f0c9bae7` (`Unify playback lifecycle events`)
- PR: #185, https://github.com/ctoth/cacophony/pull/185
- PR body includes `Closes #173`.
- CI run 30868158543 completed green: lint/format, type check, Node 20/22/24 tests, and build all passed.
- PR #185 merged as `3ad784e2` on 2026-08-04, and the `Closes #173` phrase closed issue #173.

## Blocker and next action

- No blocker or next action. Delivery and closure are verified complete.
