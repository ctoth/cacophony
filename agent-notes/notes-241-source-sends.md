2026-09-30 checkpoint: issue #241 in isolated worktree C:/Users/Q/code/cacophony-issue-241, branch feat/241-source-sends from ac69f1ad.
Regression-first proof: 19 intended failures, including native gain jumps; removal, in-place ramps, interpolation, Group and stream coverage now pass.
Shared teardown removes both send edges and bus registration, preserves primary routing, and is reused by bus drain; destroyed bus references are accepted.
Build/package checks passed; focused Chromium/Firefox rendering passed, Windows WebKit lacks OfflineAudioContext and skipped. Full Vitest/type and browser gates are running.
No blocker. Next: inspect final gate results and diff, commit only scoped files, open PR with Closes #241, verify exact-head CI; merge is not authorized.

Delivery checkpoint: published PR https://github.com/ctoth/cacophony/pull/245 with Closes #241, exact head b07c1351b933673203e190e1dbf3ca5e4e760f4d.
Final local build, package types/bundles, Biome, changelog, typecheck and full Vitest/type gate passed; full browser gate passed with Windows native WebKit skips.
Hosted run 36785825477: lint/type, Node 20/22/24, Chromium and Firefox passed; Changelog run 36785825471 passed.
Linux WebKit is still installing dependencies (step started 22:29:17 UTC), before its test step; aggregate Build follows the browser matrix.
Worktree is clean, one scoped commit, PR open and mergeable. Continue CI monitoring; do not merge.

22:38:26 UTC: WebKit remains in the Playwright dependency-install step started at 22:29:17; tests have not started.
All completed hosted checks remain green; aggregate Build waits on WebKit. Recent master runs finished successfully in about 2.5 minutes.
Implementation and authorized PR publication are complete; hosted WebKit/Build acceptance is still pending, not claimed as passed.
PR #245 retains exact head b07c1351b933673203e190e1dbf3ca5e4e760f4d. No CI failure or source fix is currently indicated.
Preserve this worktree and original notes; any CI continuation should inspect the same run/head first and handle actual failures before claiming green.
