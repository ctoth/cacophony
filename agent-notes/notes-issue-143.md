# Issue 143 checkpoint

## Findings

- GitHub issue #143 is open: `Playback.clone()` drops `_fadeInConfig`, `_fadeOutConfig`, and `_pitchFactor`.
- Current `origin/master` still has the defect in `src/playback.ts`.
- Existing unrelated untracked `notes-*.md` files are present and must remain untouched.
- Existing pitch-shift test helpers `makeFakePvNode` and `inspectPlayback` are in `src/pitch-shift-resurrection.test.ts`.

## TDD state

- Added a clone fade-config regression to `src/playback.test.ts`.
- Added a clone pitch/worklet-ownership regression to `src/pitch-shift-resurrection.test.ts`.
- Focused red run:
  - `npm test -- src/playback.test.ts src/pitch-shift-resurrection.test.ts`
  - 2 failed, 66 passed.
  - Fade clone config is `undefined`.
  - Clone pitch remains `1` instead of the original factor `2`.
- Implemented direct spread copies of both fade configs and the existing fire-and-forget `setPitchShift` pattern in `Playback.clone()`.
- Focused green run after implementation: 2 files passed, 68 tests passed.
- `npm run lint` passed.
- Type checking completed with no errors during the full test/build attempts.
- The full `npm run ci:test` gate is locally blocked by host-wide V8 worker OOM/spawn exhaustion in unrelated suites; 34 files and 595 tests passed before worker collapse in the captured run.
- `npm run build` passed typecheck and then exited during `rollup -c` without an emitted source error under the same host resource exhaustion.
- The repository-local `lint-staged` executable passed over all three staged files.
- Commit `da62f5b` records the complete TDD slice.
- PR #148 included `Closes #143`.
- GitHub CI passed Lint & Format, Type Check, Test (Node 20), Test (Node 22), Test (Node 24), and Build.
- PR #148 merged as `0f7d39ca49881ed6ab06fb13d75a32c95a785d2b`.
- Issue #143 is closed.

## Blocker

- None. Local full-suite/build completion was blocked by host process/resource exhaustion, and GitHub CI supplied the green merge authority.

## Next action

- None; the requested issue, PR, green-CI, merge, and close workflow is complete.

This note is a local checkpoint and must remain uncommitted.
