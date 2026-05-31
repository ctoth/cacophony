FIXED (clean)

Workflow actually used: `prompts/codex-review-commits.md` re-review, scoped to commit `8bf5d94` on `recover/modern-audio` and the prior minor finding in `reports/codex-commit-b45d73c-expander-fix.md`.

Review inputs read: `prompts/codex-review-commits.md`; `reports/codex-commit-b45d73c-expander-fix.md`; `prompts/fix-b45d73c-gate-test.md`; `reports/fix-b45d73c-gate-test.md`; `git show --unified=80 8bf5d94 -- src/processors/dynamics-core.test.ts src/processors/dynamics-core.ts src/cacophony.ts src/processors/dynamics.ts`; current `src/bundles/dynamics-bundle.js` / `src/bundles/dynamics-core-bundle.js` searches.

1. Single source of truth: clean. `src/processors/dynamics-core.ts:57` defines `DYNAMICS_DEFAULTS`; `src/processors/dynamics-core.ts:72` defines `GATE_DEFAULT_RATIO`. `src/cacophony.ts:24` imports `GATE_DEFAULT_RATIO`, and `src/cacophony.ts:1141` uses it in `createGate`. `src/processors/dynamics.ts:1` imports `DYNAMICS_DEFAULTS`, and `src/processors/dynamics.ts:36` / `src/processors/dynamics.ts:38` use its threshold and knee defaults in `parameterDescriptors`. The test imports those same symbols and derives `T/R/W` at `src/processors/dynamics-core.test.ts:213`-`src/processors/dynamics-core.test.ts:215`, with no local `T=-24`, `R=0.1`, `W=6` literals left in that test. The test is now tied to the shipped default symbols; its `ratio < 1` and `knee > 0` guards fail if the default gate stops exercising the expander soft-knee path.

2. Load-bearing no-boost assertions: intact. The regression test still asserts no boost at the default gate lower knee edge at `src/processors/dynamics-core.test.ts:222`, then sweeps the default knee span and asserts `yG <= xG` at `src/processors/dynamics-core.test.ts:224`. The broader expander soft-knee no-boost property test is also still present at `src/processors/dynamics-core.test.ts:149`.

3. Not theater: clean. The test is not merely asserting imported constants; it feeds the real shipped gate defaults into `computeStaticGain()` and checks the regression property. Focused verification passed: `npm test -- --run src/processors/dynamics-core.test.ts` => 1 test file passed, 26 tests passed.

4. Dynamics bundle parity: clean. Current generated bundle code uses `DYNAMICS_DEFAULTS` in the worklet descriptors at `src/bundles/dynamics-bundle.js:248`-`src/bundles/dynamics-bundle.js:253`, and the old hard-coded descriptor form `["threshold", -24` is absent from `src/bundles/dynamics-bundle.js` / `src/bundles/dynamics-core-bundle.js`. `git log -- src/bundles/dynamics-bundle.js src/bundles/dynamics-core-bundle.js` shows `d90da36` regenerated the dynamics bundles after `8bf5d94`. `git diff -- src/bundles/dynamics-bundle.js src/bundles/dynamics-core-bundle.js src/processors/dynamics-core.test.ts src/processors/dynamics-core.ts src/processors/dynamics.ts src/cacophony.ts` was empty before writing this report.

No issues remain for the prior minor finding.
