Reviewer: Claude Code (Anthropic), model Claude Opus 5.5 (`claude-opus-5-5`).

# Re-review of Cacophony #104 at bf5e9a2b

**Range checked:** HEAD is bf5e9a2b, one commit on top of ce0986ab, and the working tree is clean. I read the diff from ce0986ab to HEAD for all 8 changed files, plus the existing clone callers and tests (`sound.test.ts:351,375`, `playback.test.ts:435,444`, `synth.test.ts:218`). I did not run the tests or the build because this pass was read-only. The red/green results and the final gate are the author's report, not something I reproduced.

## F1 (clone paths disagreed): fixed
- **All three clones now preflight the same way.** `Sound.clone` (`sound.ts:164`), `Synth.clone` (`synth.ts:74`) and `Playback.clone` (`playback.ts:881`) each call `validateSpatialOptions(overrides, panType)` against the target mode. In all three it runs before any construction or node allocation: before `new Sound` / `new Synth`, and before `createGain` in Playback.
- **Nothing is silently dropped any more.** Playback's old conditional validation, which discarded fields that didn't fit the mode, is gone. Sound's gate at `sound.ts:188-198` remains, but it now only runs on overrides that already passed validation.
- **The tests cover it.** The new `describe.each` runs on all three owners and covers incompatible `position`, incompatible `threeDOptions`, `stereoPan` on HRTF, and invalid stereo pans (5 and NaN). It spies on `createGain`, `createBufferSource` and `createOscillator` to prove nothing is allocated, and compares source snapshots before and after. In the Playback case, the voice is created before the spies are installed, so the "no allocation" assertion is genuine.
- **No regressions in existing callers.** The existing clone tests pass either compatible overrides or none, so the new check doesn't affect them. The valid mode-change test (`spatial-controls.test.ts:185-187`) is still there.

## F2 (Synth stored an unvalidated stereo default): fixed
The raw write `clone._stereoPan = stereoPan` (`synth.ts:92`) is still there, but it can now only receive one of two things: an override that passed `validateSpatialOptions`, or the source's own `_stereoPan`, which only validated writes can set. The tests cover 5 and NaN.

## F3 (Group position): fixed
- **Empty groups are validated.** `validatePosition` is now exported from `playOptions.ts` and called before the member loop, so an empty group rejects `[NaN, 0, 0]`.
- **The group owns its arrays.** The setter stores `[...position]` and the getter returns a copy. The test mutates both the caller's input array and the returned array and checks that neither changes the group or its member.

## F4 (stream reuse, cleaned voices, readonly `panType`): response accepted
- **Stream reuse is now pinned by a test.** A PCM stream (HRTF by default) whose voice was switched to stereo rejects all three source-level setters. The voice keeps its pan and keeps playing, and voice-level `stereoPan` still works.
- **The CHANGELOG and README now cover the behaviour changes.** They name the clone rejection and the nonnegative cone-angle limit. The Group fix is listed under Fixed.
- **Cleaned-voice behaviour and the readonly `panType` declaration** are deliberate choices that fall within the approved contract. I have nothing further on either.

## New observation (optional, not part of this issue)
The clone preflight does not check that `panType` itself is a valid value. `clone({ panType: "foo" as PanType })` passes `validateSpatialOptions`, because that function never checks the mode string. That gap already existed before this PR in all three clone paths, and TypeScript callers can't hit it. If you want to close it, the smallest fix is to add the existing `choice("panType", …)` check to the clone preflight. It does not block approval.

## Verdict: APPROVE

F1 and F2 are fixed at the root cause and covered by tests that check both that no state changes and that no nodes are allocated. F3 is fixed, and the F4 responses are sound. I found no new regressions in the affected callers, and nothing blocks approval. My approval rests on reading the code; it depends on the author's final gate passing, which I did not run myself.
