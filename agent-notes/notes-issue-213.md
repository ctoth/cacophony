Issue #213: Playback.seek now emits seek(time) once after accepted buffer/media seeks; Sound relay intentionally omitted and documented.
Isolated worktree C:/Users/Q/code/cacophony-issue-213, branch fix/issue-213-seek-event, commit b4c05d7f.
Regressions demonstrated missing events before fix; focused/full Vitest, build/typecheck, Biome and diff checks passed.
PR https://github.com/ctoth/cacophony/pull/237 opened with Closes #213; merge not authorized.
Next: inspect exact-head CI and resolve failures if present. No blocker currently.
