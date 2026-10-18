Issue #212: worktree C:/Users/Q/code/cacophony-issue-212, branch fix/212-stopped-playbacks, based on origin/master 8b34b5fb.
Chosen issue-approved contract: reap stopped entries at Sound.preplay(); expose BasePlayback.state and re-register successful stopped-playback restarts.
TDD: four regressions failed for the expected state/retention reasons, then all 71 focused lifecycle tests passed.
Lint and build passed (35 TypeDoc warnings); full ci:test is running in session 41332. No blocker identified.
Next: inspect full test results and final diff, commit the six issue files, push and open a PR with Closes #212; no merge requested.

PR #235 opened at b23b09e2; all nine CI checks passed. User requested Claude Fable review and fixes.
Fable completed read-only review, report C:/Users/Q/code/cacophony-212-claude-review.md; identified stale replay routing, missing natural-end forwarding, detached-voice teardown, and deferred media restart races.
Six new regressions fail for those concrete reasons in sound-replay.test.ts and media-element-rejection.test.ts; no production repairs applied yet.
Prepared and uniquely counted production patch anchors for cancellation generation, Sound-owned readmission, reap disconnection, and doc nits.
Next: apply repairs, validate, obtain a fresh Fable review, then update the existing PR. No merge authorized.

Applied Sound-owned replay readmission, output/send disconnection at reap, event resubscription, and pending-media cancellation guards; reset loop count on stopped replay.
All six new regressions now pass; 165 focused tests, typecheck, lint, and diff whitespace checks passed.
Fable second review running in session 57333, stdout C:/Users/Q/code/cacophony-212-claude-rereview.md; build running in session 27699.
Documentation explains current-route restoration and retention of individual settings; addressed stale stop-test comment, state JSDoc, and avoid unnecessary array churn.
Next: finish build and full tests, receive Fable verdict, fix further findings if needed, then commit/push and check PR #235 CI.
