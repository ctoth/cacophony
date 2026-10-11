Issue #229 is implemented locally in ../cacophony-issue-229 on fix/229-http-cache-policy; no publication authorized.
HTTP policy governs both layers; versioned metadata and bytes are stored atomically; CORS-filtered responses bypass retention.
61 focused tests and 12 real-browser tests passed; full build and existing bundle thresholds passed (AudioCache gzip 9746 bytes).
Three new regressions now reproduce persistence of failed/cancelled decodes; fix by storing only after successful decode and evicting rejected persistent bytes.
Next: finish failure-path fixes, run final lint/unit/browser/build checks, measure baseline bundle, and leave a clean scoped branch result.

Failure-path fixes pass; 63 focused tests pass on Node 20 and 24, and full Node 22 suite previously passed 1200 tests.
Node 20 revealed per-subscriber progress timestamps; deterministic regression added and event timestamp now captured once.
Full browser run: 21 passed, 5 platform skips, one Firefox context-close infrastructure error; that exact test passed on retry.
Same-toolchain consumer comparison: baseline 13586 bytes / 4033 gzip; implementation about 35446 bytes / 9767 gzip, below existing gates.
Final build and lint pass; next final test run against built artifact, scoped local commit, and branch delivery (no PR/push).

CORS regression corrected in 6545de72 after initial implementation 5a01c41a; both commits on fix/229-http-cache-policy.
Validation: 1200 unit tests, 27 cache browser tests, Node 20/24 cache suites, build/types/lint/bundles pass.
User requires the branch checked out in the original repository for Codex review, not the separate worktree.
Original checkout has only unrelated untracked notes; issue worktree has only its untracked task note.
Next: detach the issue worktree and switch the original checkout to the existing branch, preserving all notes and commits.
