Issue #231 checkpoint: isolated worktree C:/Users/Q/code/cacophony-issue-231, branch fix/231-clone-empty-filters, based on latest fetched origin/master 665b3325.
Reproduced two empty-filter failures, then replaced the length-based fallback with nullish coalescing; tests cover inheritance/replacement, original active playback isolation, and sprite bounds/identity/shared-buffer lifetime.
Build, Biome, diff check, and all 1195 tests across 90 files passed with no type errors; focused suite passed 93 tests.
Committed only three issue files as 0f2b2aee; primary checkout cache changes and existing notes preserved. No blocker.
Next: push branch, open PR with Closes #231, and verify CI on the published head. Merge is not authorized.
