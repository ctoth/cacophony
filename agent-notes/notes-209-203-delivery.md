Checkpoint 2026-09-30: Issues #209 and #203 are implemented together in isolated worktree C:/Users/Q/code/cacophony-209-203, branch feat/209-203-audio-session, base 4bcc0288.
Shared context-state event publication deduplicates explicit/native transitions; browser recovery, device inventories, sink selection/events, disposal, and explicit-pause protection are implemented.
Red-first regressions recorded; focused suites, native Node sink test, types, Biome, changelog check, and Chromium/Firefox browser checks pass. Windows WebKit lacks AudioContext and skips these tests.
Full build is running in exec session 71081; no current product blocker. Primary checkout notes preserved and this checkpoint remains uncommitted.
Next: complete full build/tests and browser gate, inspect final diff, commit scoped files, open one PR closing both issues, and verify exact-head CI without merging.

Checkpoint 2026-09-30: PR #247 is open at b0da6ed15f5135760e5441407e1f32b99f974f94 and closes both issues; local full suite/build/browser checks passed.
CI run 36808335932 passed Linux WebKit/Chromium, types, lint, changelog, and Node 20; Firefox timed out at initial real-time resume, and Node 24 inherited source-sends.offline.test.ts suspend/startRendering race also present on base run 36807036069.
Linux reproduction uses isolated /tmp/cacophony-209-203-linux/repo with Node 24.9.0; initial native focused tests passed, headless Firefox reproduction is running in exec session 36348.
An uncommitted controlled-clock alternative for the inherited offline test currently fails continuity assertions and must be corrected or reverted; no production code has changed since PR publication.
Next: resolve fixture audio environment and native suspension race with durable test setup, verify narrow changes, push scoped follow-up, and obtain exact-head CI; do not merge.

Checkpoint 2026-09-30: Head d2c1530f adds only a Firefox CI virtual PulseAudio sink; production remains at b0da6ed1. Linux Firefox reproduced the timeout with PULSE_SERVER removed, then passed both session tests with a real Pulse server.
The controlled-clock alternative was reverted byte-for-byte; inherited source-sends tests remain intact. Native focused Linux tests pass; the first broad Linux run lacked dist and failed CLI fixtures, so a proper build/full rerun is running in exec session 29065 (confirm returned handle).
actionlint 1.7.12 passed the workflow. zizmor 1.30.1 reported existing unpinned actions, default permissions, and persisted checkout credentials; the new audio setup adds no such surface.
PR #247 remains open and unmerged; new exact-head CI is pending. All notes and temporary artifacts are outside the committed worktree inventory.
Next: read Linux build/test completion, monitor new CI, and address any recurring inherited offline race based on evidence rather than weakening assertions.
Handle correction: the actual Linux build/full-test exec session is 95566; 29065 in the preceding checkpoint was an unconfirmed placeholder.

Final checkpoint 2026-09-30: PR https://github.com/ctoth/cacophony/pull/247 closes #209 and #203, remains open/unmerged, and is mergeable at d2c1530fd81e032b52c84e92a533e7c2cb3ccedb.
Exact-head CI 36809171735 and Changelog 36809171596 passed every gate, including Node 20/22/24, Chromium/Firefox/WebKit, and aggregate Build.
Linux full build plus all 104 files/1401 tests passed; hosted WebKit and Firefox logs confirm both session tests executed successfully, with only unsupported output selection skipped.
The inherited offline suspension race passed unchanged on the final CI run; no source-sends edits remain. Firefox CI adds a tested virtual PulseAudio output for native real-time resume.
Committed worktree is clean, primary unrelated notes preserved, all checkpoints uncommitted; delivery through PR publication and exact-head verification is complete. Mobile OS interruptions and physical hot-plug remain the documented manual matrix.
