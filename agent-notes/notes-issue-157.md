# Issue 157 delivery checkpoint

## Findings

- Issue 157 covers built effect graphs leaked when duplicate handles are rejected by `EffectChain.add` and `Bus.addFilter`.
- Both paths accepted ownership after build/normalization but threw without calling the rejected graph's optional `dispose` callback.
- Existing `EffectChain.resolve` behavior establishes the intended dispose-before-throw policy.
- Existing test infrastructure in `src/setupTests.ts` and the disposal-spy patterns in the focused suites were sufficient; no new helper was needed.

## TDD evidence

- Red: `npx vitest run src/effectChain.test.ts src/bus.test.ts --no-color` failed 2 new tests because each duplicate graph disposal spy had 0 calls; 61 other focused tests passed.
- Green: the same focused command passed 63 tests.
- `npm run lint` passed.
- `npm run ci:test` passed 82 files, 1,112 tests, with no type errors.
- `npm run build` completed successfully with the repository's known TS4094 declaration diagnostics and 35 TypeDoc warnings, reporting 0 build errors.

## Current state

- Branch: `agent/issue-157-effect-disposal`
- Commit: `f285bb7b` (`Dispose rejected duplicate effect graphs`)
- PR: #178, ready for review
- PR body contains literal `Closes #157`.
- CI run 30857291649 is in progress with Lint & Format, Type Check, and Test jobs for Node 20, 22, and 24.
- Unrelated pre-existing `notes-*.md` files remain untracked and untouched.

## Blocker

- No implementation blocker. Merge is gated on every CI job reaching terminal success.

## Next action

- Watch PR #178 checks to terminal green, inspect any failure logs if needed, merge the PR, then verify the PR is merged and issue #157 is closed.

## Final outcome

- CI run 30857291649 completed successfully: Lint & Format, Type Check, Test (20), Test (22), Test (24), and Build all passed.
- PR #178 was squash-merged at 2026-08-03T22:07:57Z as `7f9d09076f568756efbc6d7eba06260640590caa`.
- Issue #157 closed automatically from the PR's `Closes #157` line at 2026-08-03T22:07:58Z.
- No blockers remain.
