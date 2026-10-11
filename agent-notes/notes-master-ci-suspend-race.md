# Master CI repair checkpoint
- Master CI 36807036069 fails two source-send offline tests with InvalidStateError in native suspend; PR 246 run 36803742741 tested the identical tree b27f034d and passed.
- Earlier PR CI caught the same race in spatial tests; its repair migrated only spatial tests, leaving source-send and occlusion interruption fixtures vulnerable.
- Isolated worktree C:/Users/Q/code/cacophony-master-ci on fix/native-offline-suspend-race migrates all remaining native offline suspensions to browser fixtures, retaining waveform assertions and mandatory Chromium coverage.
- Build, Biome, changelog check, focused browser checks pass; twelve original focused native runs passed locally, demonstrating intermittent behavior. Full Vitest is running; no blocker.
- Next: finish full tests, review scoped diff, publish repair PR and verify exact-head CI; merge authority has not been separately stated.

## Published repair checkpoint
- PR #248 is open at d809752471d407eb05a0d309832058457838e61b; seven scoped test/instruction files, clean repair worktree, primary checkout notes preserved.
- Full local gates passed: build, Biome, changelog validation, 101 Vitest files / 1367 tests, 62 browser tests / 22 Windows capability skips.
- All three migrated Chromium checks fail when ramp anchoring is deliberately broken and pass when restored; production tree restored exactly, temporary local config removed.
- Hosted CI 36808365951 has passed all Node 20/22/24 and browser jobs; final Build is pending. Changelog passed via existing skip-changelog exemption for test/instruction-only changes.
- Inferred master-repair scope includes normal merge; announced plan to merge once all checks pass. Next: confirm exact-head green, normal-merge PR #248, verify master CI and two-parent commit.

## Merge checkpoint
- All exact-head checks passed for d8097524: CI 36808365951 and changelog 36808418183; hosted Chromium logs show all three migrated interruption checks executing and passing.
- PR #248 normally merged as b572af3db5351517e33deaa8e8cb1953350baecf, with parents 4bcc0288 and d8097524 verified.
- Primary master checkout fast-forwarded while preserving existing untracked notes; isolated repair worktree retained and clean.
- Master CI 36808637849 is running on b572af3d; changelog 36808637885 already passed, docs deployment is running.
- Next: wait for master CI terminal result, fix any in-scope failure, then report merged repair and the intermittent same-tree explanation.

## Completed
- Master CI 36808637849 completed successfully on b572af3db5351517e33deaa8e8cb1953350baecf; docs 36808637841 and changelog 36808637885 also passed.
- Remote master and primary checkout both verified at b572af3d; PR #248 verified merged and isolated repair worktree remains clean.
- Root cause: asynchronous native suspend registration loses to rendering; PR #246's final green and failed master runs used identical tree b27f034d655a9de4917ef9780c5cef716e560319.
- Earlier PR CI detected the spatial instance but repaired only that fixture; this repair migrates every remaining native offline interruption check, with mandatory Chromium assertions and static Node checks retained.
- No remaining task work; primary notes, including these checkpoints, remain uncommitted.
