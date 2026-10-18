Issue #232: implement per-voice PlayOptions and publish a PR; merge is not requested.
Isolated worktree C:/Users/Q/code/cacophony-issue-232, branch feat/232-play-options, base ce242a9d.
Issue requires preflight for groups, unchanged ordered cursor on rejection, failure cleanup, direct Playback and synth support.
Source inspection started; npm ci is running as session 44592. No production edits yet.
Next: trace shared spatial setters, add focused regression tests, implement shared validation/application, run gates and publish.

Checkpoint: npm ci completed; 18 focused tests fail for missing overrides/validation/fades/cleanup (red-232.log).
Added PlayOptions fields and internal playOptions.ts validation/application; integrated Sound, Playback, Group preflight.
Moved panner reconnection into BasePlayback to cover synth and live stream voices; direct Playback now owns fades.
Still need synth/live-stream integration, preparation cleanup, sprite/public-export regressions, then focused and full gates.
No commit or publication yet; main checkout notes remain uncommitted.

Checkpoint: first 18 focused regressions passed; production typecheck passed after explicit context plumbing.
Synth/media/PCM options integrated with explicit unsupported-control rejection; base panner reconnection shared.
Added preparation rollback cleanup for Sound/Synth and container start cleanup; sprite native rendering and event/preparation tests added.
Public package type fixture and README now demonstrate options; scoped Biome formatting passed.
Next run expanded focused suite, add live-source coverage, inspect final diff, build/full CI test/lint gates, commit/push/PR.

Checkpoint: build passed with 35 TypeDoc warnings; lint, whitespace check, and focused test typecheck passed.
Full npm run ci:test finished exit 0 (session 31160); summary not yet read from suite-232.log.
Added native scheduled fade rendering, sprite rate/bounds/isolation, synth at-start and failure tests, media and PCM forwarding tests.
Base refreshed and remains ce242a9d. Implementation diff reviewed; no publication or commit yet.
Next extract full-suite results, verify staged inventory, commit/push, create PR with Closes #232, monitor exact-head CI.

Checkpoint: PR #236 opened with Closes #232; initial implementation commit 887c2a95 passed local 1231 tests across 92 files.
Initial Node20 CI failed because three native tests lacked the existing optional-backend guard; all browser jobs passed.
Added src/AGENTS.md native-test availability guidance in standalone 8332458c, then guard fix 48476edb.
Corrected focused run passed all 22 tests locally (native tests executed); test typecheck and formatting passed; pushed current head 48476edb0cfc996b1d7e07afb2d66f92878ef03a.
PR is same-repository; tracked worktree clean. Waiting for replacement exact-head CI; no merge authorized.
