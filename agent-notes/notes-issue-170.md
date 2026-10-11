# Issue 170 delivery notes

## Findings and observations

- `isCacophonyBuiltBiquad` used module-global WeakSet membership without checking the target bus context, so a factory-created biquad could be admitted to a foreign audio graph.
- `isCacophonyEffect` intentionally checks only for a callable `build`; malformed build results reached `EffectChain.normalize` and failed later with unrelated connection errors.
- The shared boundary is `EffectChain`, which is used by both buses and playbacks.
- Existing untracked `notes-*.md` files were preserved and never staged.

## Implemented

- Added context-aware biquad admission in `Bus.addFilter`.
- Added a reusable `isBuiltEffect` guard and an early scoped error at `EffectChain.normalize`.
- Added focused regressions for foreign-context biquads and malformed effect build results.

## Validation and delivery state

- Red proof: both new tests failed before implementation.
- Focused green: 90 tests passed across bus, effect-chain, effects, and source-effects suites.
- Full local gates: lint passed; typecheck passed; 82 test files / 1,133 tests passed; build passed with pre-existing TS4094 and TypeDoc warnings.
- Commit: `3c5d70f5bc7e53f886267ea1ea2a27ee39e0dc0d`.
- PR #188: merged at 2026-08-04T03:26:27Z with merge commit `296b104eaeed61d30088b7d25054dbdfd5303437`.
- PR body contains literal `Closes #170`.
- Issue #170 is closed.
- All required CI checks passed: lint/format, typecheck, Node 20/22/24 tests, and build.

## Blocker

- None.

## Next action

- Deliver the completed result to the user. Keep this note uncommitted.
