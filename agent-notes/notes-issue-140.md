# Issue 140

## Current state

- Branch: `issue-140-effect-chain`, based on current `origin/master` at `ac2a68d`.
- Stage A is committed as `5f7afc7 refactor: extract effect chain from bus`.
- Stage B is committed as `965ce16 feat: move playback effects before panning`.
- PR #150 merged into `master` as `b6c11f21c2566f02b66b105c45ebcdcdd5888e92`.
- Issue #140 is closed by the PR body phrase `Closes #140`.
- Existing user-owned untracked `notes-*.md` files remain untouched.

## Findings

- Stage A remains valid: `Bus` still owns built-effect normalization, incremental edge reconciliation, bypass, reorder, parameter automation, and disposal.
- Stage B remains valid: `Playback`, `SynthPlayback`, `PcmStreamPlayback`, and `MediaStreamPlayback` still own separate post-panner `refreshFilters` implementations.
- The phase-vocoder is still special-cased in `Playback` through `_pitchShiftNode`.

## TDD evidence

- Unchanged Bus baseline passed: `npm test -- src/bus.test.ts src/bus-integration.test.ts` (76 tests).
- Added `src/effectChain.test.ts` before production code.
- Red: the test suite failed because `./effectChain` did not exist.
- Implemented `src/effectChain.ts`.
- The first implementation run found a bad endpoint-graph test fixture; the fixture now owns its internal `graphInput -> graphOutput` edge.
- Green: `npm test -- src/effectChain.test.ts` (3 tests).
- Stage A delegation green: `npm test -- src/effectChain.test.ts src/bus.test.ts src/bus-integration.test.ts` (79 tests).
- Stage A also passed `npm run typecheck` and `npm run lint`.
- Stage B test-only edits now require pre-panner filters for buffer, media-element, synth, PCM-stream, and media-stream sources.
- Pitch-shift tests now require the phase-vocoder to appear in the owned EffectChain rather than a `_pitchShiftNode` field.
- Playback tests now require inherited filter reorder, bypass, and parameter automation methods.
- Stage B red: 12 focused failures proved the old post-panner topology, missing BasePlayback chain ownership, retained pitch field, and missing inherited controls.
- Stage B focused green: 5 files and 110 tests passed.
- Full typed gate green: 73 files, 1069 passed, 1 skipped, and no type errors.
- `npm run typecheck` and `npm run lint` passed.
- `npm run build` exited 0. It retained the repository's TS4094 and TypeDoc warning behavior; internal EffectChain references add a non-fatal docs warning because EffectChain is intentionally not exported as a new public feature.
- The build rewrote four tracked generated bundle files unrelated to issue #140. They are verification churn and must be restored before staging.

## Blocker

- None.

## Next action

- None. Issue #140 is resolved, PR #150 is merged, and all required CI checks passed.

## Note handling

- This file is a required uncommitted handoff record. Do not stage, commit, or push it.
