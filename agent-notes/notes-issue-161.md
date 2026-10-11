# Issue 161 progress

- Issue: remove the stale `Sound.preplay()` microtask workaround, the wrong/redundant `SynthPlayback.cleanup()` source-to-panner disconnect, and unused `FilterManager.applyFilters` / `removeFilters` methods plus the stale efficiency todo.
- Checkout started clean for tracked files on `master` at `9fbc74d7`; existing untracked `notes-*.md` files are unrelated and must remain untouched/uncommitted.
- Branch: `agent/issue-161-dead-code-sweep`.
- TDD red command: `npm test -- src/sound.test.ts src/synth.test.ts`.
- Red result: 3 expected failures and 97 passes. Failures proved the obsolete filter methods existed, natural-end unsubscription was deferred, and synth cleanup directly disconnected source from panner after effect-chain teardown.
- Implementation now removes only the issue-listed stale code. Tests use the existing `expectPath` graph helper for the synth effect-chain path.
- Green evidence: focused tests passed 100/100; `npm run lint`, `npm run ci:test`, and `npm run build` all exited successfully. The build retained the repository's existing TS4094 declaration diagnostics and 35 TypeDoc warnings but reported zero build errors.
- Commit: `490ec44a` (`Remove stale audio cleanup code`).
- PR: https://github.com/ctoth/cacophony/pull/176 with literal `Closes #161`.
- CI: all 6 checks passed (Lint & Format, Type Check, Test on Node 20/22/24, Build).
- Merge: PR #176 merged at `f4455d793389cb1fe274eadf0ea49baf41fdb5b4`; issue #161 is closed as completed.
- Local state: `master` fast-forwarded to `origin/master` at `f4455d79`; unrelated untracked notes remain untouched.
- Current blocker: none.
- Next action: none; task complete.
- This note is a checkpoint artifact and must not be staged, committed, or pushed.
