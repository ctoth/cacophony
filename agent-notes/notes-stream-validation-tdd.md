2026-09-13: Review fix for reused live stream voices, requested with TDD.
Five regression tests initially failed: MediaStream/PCM rejection preservation and inherited stereo validation, plus reused voice start failure cleanup.
Container cleanup now skips existing voices; stream validation uses the reusable voice's effective pan type. Resume tests respect the existing active-play no-op behavior.
Focused suites, npm run build, npm run ci:test, changed-file Biome checks, and git diff --check passed; build emitted documentation warnings.
Changes remain local and uncommitted; unrelated notes preserved. No blockers or remaining implementation work.
