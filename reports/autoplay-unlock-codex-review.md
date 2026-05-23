# Codex review: autoplay-unlock

## Verdict
CHANGES_REQUESTED

## Summary
The implementation is mostly aligned with the brief: listener installation is gated correctly for suspended/browser/default-autoUnlock contexts, offline and non-browser paths are guarded, all three listeners are removed together, re-entry is locked out, the module split is defensible, the local `createBuffer` cast is acceptable for this one call site, and the README addition is legitimate new-section content despite line-ending churn around it.

I did not rerun `npm run typecheck` or `npm test`; this review is based on the required prompt, implementer report, requested diffs, and final file inspection. The code still has two behavior-contract defects in the actual unlock path, so I do not consider it production-ready.

## Findings
1. High / unlock event semantics / `unlock` is emitted and `suspendState` is set to `"running"` before `context.resume()` has succeeded / `.claude/worktrees/agent-a8487d36b1ea4b06d/src/autoplayUnlock.ts:130` and `.claude/worktrees/agent-a8487d36b1ea4b06d/src/cacophony.ts:209` / The public `unlock` event is supposed to signal that the first gesture unlocked audio. In the current code, `resume.call(context).catch(...)` is fire-and-forget and `onUnlock()` runs immediately afterward, so a rejected or still-pending resume still emits `unlock` and marks the instance as running. A caller can observe `unlock` while `cacophony.locked` is still true, and a resume failure is reported only as a warning after the false unlock signal.

2. Medium / iOS primer contract / The primer source is started but never stopped / `.claude/worktrees/agent-a8487d36b1ea4b06d/src/autoplayUnlock.ts:117` / The original brief explicitly required the silent `AudioBufferSourceNode` to `start(0)` and `stop(0)` inside the gesture handler. A one-sample non-looping buffer will normally end on its own, but this is still a direct miss against the load-bearing primer pattern the task asked to implement, and the test suite does not assert the required `stop(0)` call.

## If CHANGES_REQUESTED
1. Keep primer creation/start synchronous in the gesture handler, but emit `unlock` and set `suspendState = "running"` only after `context.resume()` fulfills. Do not emit `unlock` on resume rejection.

2. Call `source.stop(0)` immediately after `source.start(0)` in the primer path.

3. Add focused tests for resume rejection not emitting `unlock` and for the primer calling `stop(0)`.

## Recommendation
Fix the two unlock-path contract issues, then rerun typecheck and the full test suite before promotion.
