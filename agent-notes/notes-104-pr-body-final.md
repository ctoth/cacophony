Spatial setters could store invalid defaults without voices or throw after partially updating a broadcast. They now validate the source and every targeted voice before mutation, including group spatial broadcasts. Source setters, direct voices, invocation options and clone overrides share the same spatial validation.

`ThreeDOptions` now describes HRTF configuration only; panning mode selection is explicit. Clones reject spatial overrides incompatible with their target mode before allocation. Partial updates preserve omitted fields, and Group positions own their input and output arrays. README and the breaking-change changelog entries document the contract and migration.

Closes #104

Independent review: Claude Code / Claude Opus 5.5 requested fixes for inconsistent clone override handling and invalid Synth clone defaults. Both were reproduced with failing regressions and fixed; the optional Group ownership finding was also fixed and stream-reuse coverage added. Claude re-reviewed commit bf5e9a2b and approved with no remaining blockers.

Validation:
- `npx vitest run --maxWorkers=4 --typecheck`: 105 suites / 1,459 tests passed, no type errors. Includes 58 focused regressions and native HRTF-node and rendered-stereo checks.
- `npm run build`: typecheck, published-package consumer types, bundle checks and docs passed.
- `npx biome ci .` and `npm run changelog:check` passed.
- `npx playwright test --workers=1`: 67 passed, 26 Windows platform skips; no failures.
