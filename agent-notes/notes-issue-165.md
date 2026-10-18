# Issue 165 work log

## Current findings

- Issue #165 is open and reports that `FoaDecoder.sliceHrirRows` returns an unsliced HRIR when required channels are missing, allowing a wrong channel layout into the binaural convolver graph.
- Existing FOA decoder tests use an in-memory `stubHrir` helper; it was generalized with a channel-count parameter for the regression.
- The new public-API regression supplies a three-channel HRIR and expects `createFoaDecoder` to reject with the received channel count.

## TDD evidence

- Red: `npx vitest run src/foaDecoder.test.ts --no-color` failed because the malformed HRIR promise resolved instead of rejecting.
- Green: the focused suite passes 26 tests after validating at least four channels before graph construction.
- `sliceHrirRows` no longer has the test-shaped unsliced-buffer fallback.
- Context capability validation now includes `createBuffer`, so buffer allocation cannot silently fall back either.

## Validation

- `npm run lint`: passed.
- `npm run ci:test`: passed, 82 files and 1,124 tests, no type errors.
- `npm run build`: passed with the repository's existing TS4094 declaration diagnostics and 35 TypeDoc warnings.

## GitHub state

- Branch: `agent/issue-165-validate-hrir-channels`
- Commit: `5e3a61a5` (`Reject malformed FOA HRIR buffers`)
- PR: #184, https://github.com/ctoth/cacophony/pull/184
- PR body contains literal `Closes #165`.
- Current CI run 30867329801 has lint, type check, and Node 20/22/24 tests in progress.

## Blocker and next action

- No blocker. Wait for every required PR check to succeed, merge PR #184, then verify the PR is merged and issue #165 is closed.
- Keep this note uncommitted and do not include it in the PR.
