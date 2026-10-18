# Final review of revised issue 238

Please review notes-238-final-issue.md for publication readiness. This is a technical design review of the Cacophony repository, not an implementation task. Author: OpenAI Codex. Your preceding review is saved in notes-238-fable-review-20260918.md. Do not edit files or publish anything. Do not delegate. Return concise findings (aim for at most 1200 words), with verdict READY or REVISE and any concrete remaining blockers. A verdict is about the issue being implementable and internally consistent, not about existing code already passing future acceptance criteria.

The draft incorporates your findings on distinct effect error events/media acceptance, fulfilled readiness statuses, removal/disposal, pending order/bypass, inherited pitch readiness, raw admitted nodes, stream rollback/single voice, not-attached references, owner-relative serialization, and float32 domains.

Three adjudications:
1. Keep full metadata migration in #238: it is a primary requested outcome, not merely a consumer dependency. Incremental PRs remain independent of #45/#200.
2. Keep stereo pan as an initial adapter so native target replacement has a real exercised contract. Each adapter declares its replacement policy; effect-slot initial values only during preparation, owner start values remain PlayOptions.
3. Preserve disposal of separately owned rejected duplicate graphs (src/effectChain.test.ts:60 onward); do not blanket-disable duplicate disposal. Never dispose the already-admitted shared graph. Known shared duplicates reject at attach time, chain admission remains the backstop.

Additional resolved points: strict preparation is an unstarted-voice operation and accepts no deadline. It awaits inherited pitch but defers public pitch automation. It rejects known shared-node recipes before materialization to avoid exposing existing shared audio through an unstarted voice. Initial assignments only target newly owned effect-slot parameters. Cancellation uses identity-based rollback and settles promptly while late results are disposed. Source control fan-out while waiting retains existing behavior. Internal pitch ownership is explicit instead of matching arbitrary pitchFactor names.

Please assess whether these decisions are coherent, sufficient and proportionate. In particular: (a) new effect errors must not remove Sound.play's pending media-acceptance listener; (b) pending cancellation must not be reported as a build failure; (c) shared graphs and strict preparation must not promise impossible rollback; (d) no second scheduler is introduced; (e) no contradiction between immediate binding operations and existing cancellation semantics; (f) metadata and clone boundaries remain honest; (g) inherited pitch's minimal in-scope changes are testable without implementing the deferred public adapter.

Read the final draft and previous review first. Verify only specific remaining source questions as needed; prior source findings are already recorded. Return READY if only implementation choices remain. If REVISE, give exact minimal replacement wording for each publication blocker, separating optional refinements.
