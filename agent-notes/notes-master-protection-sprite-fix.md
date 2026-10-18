Checkpoint: Barn protects master with strict required checks, enforced for admins, and blocks force-pushes/deletion.
Barn also enables an ALLGREEN merge queue using merge commits; Cacophony currently has no branch protection or rulesets.
Cacophony currently permits merge, squash, and rebase methods; Barn permits merge commits only and enables auto-merge.
PR #223 and master both failed Node 24 because sprite generation opens a real output-device AudioContext on a headless runner.
Next: identify Cacophony's aggregate CI gate, mirror Barn's settings, verify them, then implement and publish the focused fix PR.
Checkpoint: strict Build protection, admin enforcement, merge-only policy, and auto-merge are active on Cacophony master.
GitHub rejected merge_queue because ctoth/cacophony is user-owned; Q explicitly chose to proceed without transfer or merge queue.
The focused repair ledger is active for sprite-headless-fix in an isolated worktree on fix/headless-sprite-generation.
An implementation owner is attached and owns production code, regression test, focused checks, and the scoped commit.
Next: receive the committed repair, run the single review and final gate, then publish one open PR without merging.
Checkpoint: implementation returned as clean candidate b13f583d7041d3c1343f8f6e4c16e2f2a1f153f9.
The commit contains only src/cli/sprite.ts and src/cli/sprite.test.ts and is one commit ahead of origin/master.
Production requests a no-output sink; the regression verifies the injected context factory receives that option.
Focused Vitest, Biome on both files, and no-emit TypeScript were reported by the owner; root verification remains pending.
Next: advance the ledger, integrate current master if needed, run one detached Codex review, then final verification and PR publication.
Checkpoint: detached Codex review completed with no actionable findings and its disposable worktree was removed.
Candidate b13f583d passed npm.cmd run build and npm.cmd run ci:test at the exact committed tree.
The final gate reported 88 test files, 1183 tests, and no type errors; the tracked implementation worktree is clean.
Fresh origin/master remains b082bacb, so the reviewed and verified candidate is not stale.
Next: run publication safety and exact diff/commit audits, push the branch, create one focused PR, and read it back without merging.
