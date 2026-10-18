Checkpoint 2026-09-13: Persistent body reads failed loading in fresh-hit and matching-304 paths.
TDD: three injected I/O failure cases reproduced the bug, then passed after shared read recovery.
Implementation evicts unusable storage and memory state, reports cache get errors, and refetches unconditionally.
Validation: 66 cache tests, typecheck, lint, and build pass; build reports 35 documentation warnings.
Next: run full ci:test and inspect final diff; changes remain uncommitted.
