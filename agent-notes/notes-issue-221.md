2026-09-30 checkpoint: Issue #221 implemented in C:/Users/Q/code/cacophony-issue-221 on feat/221-playback-occlusion from fb71414e.
Red first: 11 mock/native tests failed on missing setOcclusion/occlusion API; production then added a private lazy low-pass/gain stage and shared AudioParam ramp scheduling.
Focused lifecycle/effects/clone/fade regressions and native renders pass, including interrupted ramps and transparent reset at 32/44.1/48/96 kHz; Chromium/Firefox rendering checks pass.
README and changelog updated. Full build running (session 18134); browser command session 34965 finishing. No blockers; PR publication authorized, merge not authorized.
Next: complete full repository gates, inspect diff/commit scope, publish PR with Closes #221, verify exact-head CI. Preserve this note uncommitted.

2026-09-30 checkpoint: Published PR https://github.com/ctoth/cacophony/pull/244 with Closes #221, head 8b2944dd807ca0286f5be3fdb11f94491111173f; worktree clean.
Full local native/unit suite passed with maxWorkers 4; uncapped concurrent run had unrelated CPU-bound DSP timeouts. Build/lint/types/changelog checks passed.
Full local Chromium/Firefox browser suites passed; Windows WebKit skips audio and three cache afterAll errors passed isolated rerun (fixture file unchanged).
Exact-head CI run 36755691387 passed Node 20/22/24, lint/types and Chromium/Firefox/Linux WebKit; aggregate Build pending. Changelog run 36755691378 passed.
Next: verify final Build and actual WebKit occlusion execution, report open/unmerged PR. No merge authorized. Preserve notes uncommitted.

2026-09-30 completion: CI run 36755691387 succeeded on head 8b2944dd807ca0286f5be3fdb11f94491111173f, including aggregate Build; all PR checks passed.
Linux WebKit log confirms occlusion.spec.ts executed and passed (489 ms), with the complete browser project passing.
PR #244 remains open, ready for review and mergeable; worktree clean. Closes #221 verified in published body.
Implemented only Cacophony rendering ownership; no geometry/material/cross-repository changes and no merge performed.
Delivery complete through the authorized PR milestone. Notes remain uncommitted in the primary checkout.
