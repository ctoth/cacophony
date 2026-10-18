Spatial setters could store invalid defaults without voices or throw after partially updating a broadcast. They now validate the source and every targeted voice before mutation, including group spatial broadcasts. Source setters, direct voices and invocation options share the same spatial validation.

`ThreeDOptions` now describes HRTF configuration only; panning mode selection is explicit. Partial updates preserve omitted fields and owned snapshots, and clone mode changes continue to work. README and the breaking-change changelog entry document the contract and migration.

Closes #104

Validation:
- 105 Vitest suites / 1,442 tests passed, including 41 focused regressions and native HRTF-node and rendered-stereo checks.
- `npm run build` (typecheck, package types, bundle checks, docs), `npx biome ci .`, and `npm run changelog:check` passed.
- Browser matrix: 67 passed, 26 Windows platform skips. Five Firefox internal context-teardown failures passed in one isolated one-worker rerun.
