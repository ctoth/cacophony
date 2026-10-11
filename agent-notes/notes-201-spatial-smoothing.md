2026-09-30: #201 groomed to opt-in source/listener motion smoothing; occlusion shipped in #221, Doppler excluded.
User authorized full implementation and PR preparation, not merge; isolated worktree C:/Users/Q/code/cacophony-issue-201 on feat/201-spatial-smoothing.
New unit regressions failed on baseline for missing scheduling, configuration propagation, target getters and cleanup.
Shared exponential-envelope controller and source/voice plumbing implemented; listener integration, native/browser proof and docs remain.
Next: finish listener and Node configuration paths, correct modern-listener mock fixture, run focused regressions and final gates; no blocker.

2026-09-30: Source/listener smoothing, configuration inheritance, target getters, cloning, partial updates and cleanup implemented.
Native stereo retarget/tau-change render passes; native HRTF fixture proves at least 5x reduction in source/listener distance discontinuities.
Chromium browser target/render checks pass; Firefox target/legacy-listener check passes, offline render skipped for missing suspend/resume; Windows WebKit lacks OfflineAudioContext.
Packed build initially caught TS4094 mixin declaration emission; explicit PannerControls contract fixes it, packed-consumer regression extended, subsequent build passes.
Final docs/coverage tweaks complete; final lint/build then complete unit/native and browser suites underway; next commit, focused issue update and PR publication (no merge).

2026-09-30 checkpoint: Final source tree now includes PannerControls declaration contract and packed-consumer API checks.
Added explicit shared-path coverage for Synth, PCM streams and MediaStream voices, plus all modern listener setters.
Focused issue body and PR body prepared in uncommitted notes; tracker publication has not yet occurred.
Final lint passes; final build is running in exec session 15959, logging to worktree build-201.log.
Next: wait for build, run full ci:test and browser suites, review scoped diff, commit/push, update #201 scope and create PR; no current blocker.

2026-09-30: PR #246 open at ebcc0dc6; #201 rewritten to agreed focused contract. Local lint/build/full unit-native suite passes.
Windows full-browser cache teardown failures reproduce unchanged on master cd694bbf; focused affected-case rerun passes. All three Linux browser jobs pass.
Node 22/24 CI exposes native suspend registration race. Sequential registration during rendering also fails; upstream Rust rejects any suspend registration after start.
Native fixture changed to one pause per render (browser retains multi-point proof); Node factories also now reject invalid tau before allocating/loading backend.
Next: validate corrected fixture, commit/push fixes, follow exact new head through green CI; no merge authorized.

2026-09-30: Corrected native fixtures pass locally; full local ci:test passes, with targeted Node allocation-order regression red then green.
New commit 84a282188051b18ab8b68881fee479706d0c7ae9 pushed to PR #246; earlier feature commit ebcc0dc66610060f9facb857733cd8af2d60051e retained.
Current exact-head CI run is 36799934962; changelog run 36799935018 passed. PR remains open and mergeable; merge not authorized.
Worktree research artifact archived to main notes-201-backend-offline-source.txt so isolated git status remains clean; main user notes preserved.
Next: follow CI run through completion, diagnose any failure, verify exact head and report PR; no remaining implementation work known.

2026-09-30: Native initialization renders remain; interrupted stereo and HRTF source/listener renders now run in real browser OfflineAudioContexts.
Current PR #246 head is 50eeff0b23e14b7cba08288b618f234f5e49e548; focused native and browser regressions pass locally.
Exact-head CI 36800366149 passed all browser, lint, type, and Node 20 jobs; Node 24 failed unchanged source-sends.offline.test.ts suspend registration, cancelling Node 22.
Reran failed jobs once on the same head based on observed native asynchronous suspend race; PR body reflects final tests and reproduced Windows baseline cache teardown failures.
Next: await retry, verify required checks and clean worktree, report published PR; merge remains unauthorized and main notes remain uncommitted.

2026-09-30: Same-head retry passed Node 22 and 24, confirming the unchanged native source-send suspend failure was intermittent.
CI 36800366149 completed successfully on 50eeff0b23e14b7cba08288b618f234f5e49e548, including final Build and all three browsers; changelog also passes.
PR #246 remains open, non-draft, and mergeable with no outstanding review comments; implementation and documentation are published.
Isolated worktree is clean and diff whitespace check passes; original main checkout contains only preserved untracked notes.
Delivery complete for requested PR preparation; no merge performed or authorized.
