# Issue 238 publication check

Please perform a narrow final publication check. OpenAI Codex authored notes-238-final-issue.md. Your previous review in notes-238-fable-final-review-20260918.md found one blocker: unspecified legacy addEffect/addFilter promise settlement on pending cancellation. The draft now says:

"The promise already returned by a legacy addEffect/addFilter call rejects at invalidation with a typed cancellation error whose reason is removed or disposed, distinguishable from failed-build and carrying no build-failure cause. It never fulfills with a disposed handle or surfaces an EffectChain reservation guard error. The source materialization path handles that rejection silently: no warning or effect error event."

Acceptance 7 now explicitly checks both pending removal and owner cleanup and prohibits fulfillment with a disposed handle.

Your optional refinements are included: one internal pitch record/latest factor wins; changelog note on visible inherited pitch errors; clone's best-effort pitch failure remains silent; playback stereo-pan wording; media preparation rejects unsupported before allocation; consumers may use merged PR 1 before catalog completion; effect immediate sets do not cancel existing ramps.

The optional duplicate-disposal heuristic was not adopted: callback identity alone cannot reliably prove resource ownership. The already-reviewed behavioral contract remains: preserve an admitted shared graph and dispose separately owned rejected graph resources once; preserve existing duplicate-graph tests. No new allocation or disposal heuristic has been mandated.

Read the current draft to confirm these changes introduce no contradiction. No need to repeat the full repository audit; the prior review and adjudications are recorded. Return READY or REVISE and at most 400 words explaining any remaining publication blocker. Do not implement, edit, publish, or delegate. This is a technical issue-text review, not proof that future implementation already exists.
