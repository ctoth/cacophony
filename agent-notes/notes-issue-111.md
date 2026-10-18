# Issue 111 work log

## Current findings

- GitHub issue #111 is open and valid against current `master`.
- `OscillatorMixin(Base)` ignores `Base` and declares its class as `extends BasePlayback`.
- `OscillatorMixin` exposes `play()`, `pause()`, and `stop()` even though
  `SynthPlayback` replaces all three; its `play()` calls `source.start()`
  unconditionally.
- The deletion-first fix under test is to extend the supplied `Base` and delete
  those three shadowed controls. No helper, adapter, or interface is needed.

## Repository state

- Branch: `agent/issue-111-oscillator-mixin`
- Branch point: current `origin/master` at
  `7809408f5bd1b1f3f45adaf7776b9a286c505034`
- Pre-existing untracked notes remain untouched.
- Baseline synth gate:
  `npm run ci:test -- src/synth.test.ts src/synthPlayback-output.test.ts src/synthGroup.test.ts`
  passed with 36 tests passed, 1 existing skip, and no type errors.
- Added `src/oscillatorMixin.test.ts` to assert that the mixin inherits the
  supplied base and does not add `play`, `pause`, or `stop`.

## Observation

- The first targeted test invocation failed before collecting tests because
  Vitest globals were not imported. This is not the required RED evidence.
- The initial real-mixin regression then failed correctly because the returned
  class was not an instance of the supplied base.
- Making the supplied filter/panner/volume chain real passed that isolated test
  but failed 11 existing synth assertions because the chain does not provide
  `BasePlayback`'s `isPlaying`, `eventEmitter`, and cleanup contract.
- The issue's explicit alternative was selected: `OscillatorMixin` is now a
  plain abstract `BasePlayback` subclass, and `SynthPlayback` extends it
  directly.
- The revised regression failed because `OscillatorMixin.prototype` was not a
  `BasePlayback`, then passed after the production change. It also asserts that
  `OscillatorMixin` itself defines none of `play`, `pause`, or `stop`.

## Current validation

- Targeted regression: 1 passed, no type errors.
- Synth gate: 37 passed, 1 existing skip, no type errors.
- Lint: 140 files checked, green.
- Full typed suite: 67 files passed; 1,018 tests passed, 4 existing skips, no
  type errors.
- Build: exit 0. It reproduced the repository's existing Vite declaration
  TS4094 diagnostics and TypeDoc warnings.
- `git diff --check`: green.
- Intended commit scope:
  `src/oscillatorMixin.ts`, `src/oscillatorMixin.test.ts`,
  `src/synthPlayback.ts`.
- Commit:
  `864d7508ab8e9d8a8d6808e30ffd73601db29c05`
  (`Fix oscillator mixin inheritance`).
- PR #120 was opened ready against `master` with `Closes #111`.
- GitHub CI passed: Lint & Format, Type Check, Test on Node 20/22/24,
  and Build.
- PR #120 merged at 2026-07-29T17:27:49Z as
  `ddb2825b62405305857da66d24150f5be144ae8c`.
- GitHub verified issue #111 closed automatically by PR #120 at
  2026-07-29T17:27:50Z.
- Local tracked worktree is clean; all notes remain untracked.

## Blocker

- None.

## Next action

None. The requested TDD, PR, green-CI merge, and automatic issue closure
workflow is complete.
