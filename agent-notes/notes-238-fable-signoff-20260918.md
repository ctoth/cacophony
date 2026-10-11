**READY.** I found no remaining publication blocker.

I read the current draft against my previous review. I did not re-check the source code, as you asked.

**Blocker resolved.**
- The bullet "Removal during a pending build…" now says what happens to the legacy promise.
  - It rejects at invalidation with a typed `removed` or `disposed` reason.
  - It is distinguishable from `failed-build` and carries no build-failure cause.
  - It never fulfils with a dead handle or surfaces the reservation guard error, and the source path handles it silently.
- Acceptance 7 now tests both pending removal and owner cleanup, and prohibits fulfilling with a disposed handle.
- "Rejects at invalidation" is stricter than the wording I suggested, and it is consistent with two other parts of the draft:
  - Preparation step 4 says cancellation settles without waiting for an uncooperative build.
  - The same bullet says late results are disposed once and never connect.
- The reasons `removed` and `disposed` match the failure list in the preceding bullet.
- "Without a duplicate playback event" in the failure-reporting section still holds.

**No contradiction from the adopted refinements.**
- **Pitch record:** one internal record with latest-factor-wins makes "await inherited pitch-shift materialization" well defined. It fits the ownership rule and acceptance 9.
- **Pitch errors:** the changelog note says source-originated pitch failures become visible. The clone sentence keeps `Playback.clone` silent and outside strict preparation, so the two do not overlap.
- **Media-element Sounds:** the draft says they reject as `unsupported` before a voice is constructed. That precedes step 1, so no rollback is implied.
- **Immediate assignment:** effect assignments do not cancel ramps and owner setters keep their current cancellation behaviour. Acceptance 6 and the statement that #45 owns cancellation policy agree with this.
- **Wording:** "playback stereo pan" and the consumer start point on PR 1 conflict with nothing in the delivery list.

**Duplicate-disposal heuristic not adopted: accepted.** The behavioural contract in "Shared nodes and chain order" and acceptance 7 is testable without it. Your reasoning about callback identity is sound.

**Non-blocking notes, at your discretion.**
1. The changelog could mention one behaviour change. When an owner is cleaned up during a pending build, a legacy `addEffect` or `addFilter` promise currently fulfils. Under the new wording it rejects. A caller who ignores that promise could now see an unhandled rejection. Acceptance 7's "without unhandled rejections" applies to readiness and the source path, so this is not a contradiction.
2. Step 2 says pitch "cancellation must participate", and the draft also says the latest factor wins. The natural reading is that preparation awaits the current record and a superseded build does not fail it. One clause saying so would remove the ambiguity. Acceptance 9 will force the decision anyway.
3. Acceptance 7 lists "stop" among the pending-build cases. The expected outcome differs between a normal Playback and strict preparation.
   - **Normal Playback:** the lifecycle bullet says the build survives stop.
   - **Strict preparation:** step 4 says stop rejects.

   Both follow from the text, so the tests need to cover each case.

I made no edits, published nothing, and did not delegate. This checks the issue text only. It is not evidence that any implementation exists.
