Issue #193: the BCC core needed worklet/factory wiring and its hard-right Y sign was inverted.
Current state: core, shell, registry, factory option, docs, unit tests, and browser render coverage are implemented in the isolated issue worktree.
Local gates: lint/typecheck/build and 1,148 Vitest tests pass; Chromium/Firefox browser renders pass and Windows WebKit skips for unavailable AudioContext.
Blocker: none; Linux WebKit will be verified by PR CI.
Next: finish the scoped diff audit, commit/push, open the PR with Closes #193, wait for exact-head CI, then merge normally.
