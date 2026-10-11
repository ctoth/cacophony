# Independent review of issue 238

You are the requested external Claude Fable reviewer. The author is OpenAI Codex. Identify your reviewer/model identity at the top of the report. Return your entire report in your final response; do not write files or change code/issues. Read-only tools are available. Do not delegate.

The user requests: consult Claude Fable using the external-agents protocol, get this right, then redraft/file issue 238. We are grooming a design, not implementing it. Inspect actual source to challenge the proposed revision. We will iterate your findings before publishing.

Repository: C:/Users/Q/code/cacophony at 0986e1b3c5ad05ed2dade5582ffad96844f341b5.
Proposed revision: notes-238-proposed-revision-20260918.md (first section is review notes, everything after the separator is proposed issue text).
Existing issue and related issues are saved at C:/Users/Q/AppData/Local/Temp/cacophony-238-fable-20260918/issue-238-original.json and issue-45.json, issue-198.json, issue-200.json, issue-207.json.

Read relevant code: src/AGENTS.md, src/effects.ts, src/effectChain.ts, src/routableSource.ts, src/basePlayback.ts, src/playback.ts, src/sound.ts, src/bus.ts, src/pannerMixin.ts, src/synth.ts, src/synthPlayback.ts, src/volumeMixin.ts, src/events.ts, src/processors/phase-vocoder.ts, sourceEffects.test.ts and tests as useful. Follow actual code evidence rather than trusting the review notes.

Questions:
1. Is this the smallest coherent architecture delivering reusable typed references across recipes/live voices/buses, without a parallel scheduling system or dependency cycle?
2. Are source capture, live attachment removal, name reuse, shared-node ownership, ordering, alias identity and serialized compatibility contracts sufficient and consistent? Does this still preserve users' actual intent in the original issue?
3. Does async preparation have a real implementable contract? Check first-start/recreated sources, initial writes, synchronous vs asynchronous errors, cancellation, event delivery, retention and deadlines. Identify ambiguities needing decisions, not speculative infrastructure.
4. Are metadata extraction, domain/default/rate/units, IR configuration availability, native adapters and third-party extension design honest about current code? What practical schema/preset distinctions are still missing?
5. Critique the proposed scope reductions (pitch-shift owner adapter and clones deferred). Are they justified or are we merely hiding necessary work? What exact minimal behavior should be specified now?
6. Are acceptance criteria finite, independently testable, and enough to prevent attractive-but-wrong implementations? Can this issue close before #45/#200, with no throwaway API?
7. What can be simplified or deleted? Optimize the issue for a competent implementer, not length. Flag language that claims mechanisms exist when they do not.

Report: verdict READY / REVISE, blocking findings then material improvements, each with concrete source file/line evidence, consequence and recommended exact decision or replacement wording. Distinguish confirmed behavior from proposed design. End with the minimum revision set and any intentional tradeoffs. Be candid; do not agree merely because the draft is detailed.
