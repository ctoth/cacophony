# Issue #214 checkpoint — 2026-08-25
- Key finding: `Bus.gain` must cancel scheduled values at the bus context's current time before assigning.
- Current state: PR #218 passed 9/9 CI checks and `gh pr merge 218 --merge` exited successfully.
- Verification pending: confirm GitHub merge state, two-parent merge ancestry, `origin/master`, and issue closure.
- Blocker: none; next action is terminal merge verification.
