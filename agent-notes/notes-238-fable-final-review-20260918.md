# Final review of issue 238 (`notes-238-final-issue.md`)

## Verdict: REVISE, with one blocker that needs one added sentence

The rest of the draft is ready to publish. The three adjudications are coherent and match the source, and every finding from my previous review is covered.

## Blocker: the legacy promise outcome on pending cancellation is unspecified

The draft says what happens to readiness (`removed` or `disposed`), to events (none) and to late resources (disposed once). It does not say what happens to the promise already returned by `playback.addEffect()`, `Bus.addFilter()` or `_addSourceEffect`. Today that promise has two different outcomes, and both are wrong for point (b):

- **Reservation cancelled, then a late resolve.**
  - `EffectChain.resolve` throws "cannot resolve an unknown effect-chain reservation" (`src/effectChain.ts:90-93`).
  - The promise rejects with a guard error that looks exactly like a build failure. The source path logs it as "could not build" (`src/routableSource.ts:130-132`).
- **Owner destroyed, then a late resolve.**
  - `resolve` disposes the result and returns the handle (`src/effectChain.ts:83-86`).
  - The promise then fulfils with a dead handle (`src/bus.ts:179-180`, `src/basePlayback.ts:80-83`).
  - I found no test pinning this fulfilment. That rests on one targeted grep of the test files, not an exhaustive read.

An implementer could satisfy every sentence of the draft and leave both paths as they are. Acceptance 7's "error-after-cancellation" reads as being about events, so it would not catch this.

**Replacement wording.** Append this to the "Removal during a pending build…" bullet:

> The promise already returned by a legacy `addEffect`/`addFilter` call rejects with the same typed `removed`/`disposed` result, distinguishable from `failed-build` and carrying no build cause. It never fulfils with a disposed handle and never surfaces an EffectChain reservation guard error. The source materialization path treats this rejection as silent: no warning and no effect error event.

Add this to acceptance 7: "the legacy promise rejects with the typed cancellation result in both cases."

## Assessment of (a) to (g)

- **(a) The pending media-acceptance listener is safe.**
  - `errorType: "effect"` is the right discriminator. The playback union today is `"context" | "source" | "decode" | "unknown"` (`src/events.ts:135`).
  - The only non-test playback `error` subscribers are `src/sound.ts:363` and `src/sound.ts:417`, so no other consumer treats `error` as terminal.
  - Internal pitch failures use the same category, so the same guard covers them.
- **(b) Cancellation is not reported as a build failure**, apart from the blocker above.
  - Requiring that late results never invoke success callbacks closes the `_filters.push` of a dead node (`src/basePlayback.ts:60-62`).
- **(c) No impossible rollback is promised.**
  - I checked whether rejecting shared recipes would block strict preparation for any Sound that has legacy filters. It does not.
  - A source's `addFilter` wraps the node in `BiquadRecipeEffect`, which builds a fresh biquad per voice (`src/routableSource.ts:47-53`). It does not use the shared `BiquadEffect`.
  - Settling cancellation without waiting on an uncooperative build is the only promise the draft can honestly make there.
- **(d) No second scheduler is introduced.**
  - Effect assignment is `setValueAtTime(value, now)` (`src/effectChain.ts:183-186`). Owner assignment goes through the existing setters.
- **(e) Immediate binding operations do not contradict existing cancellation semantics.**
  - The volume and bus gain setters cancel scheduled values (`src/volumeMixin.ts:80`, `src/bus.ts:127`).
  - The pan setter only calls `setValueAtTime` (`src/pannerMixin.ts:118`). "Retain existing" is therefore accurate for all three owner adapters.
  - Setting the same `panType` again is a no-op (`src/pannerMixin.ts:68-71`). "Can invalidate" is the correct wording, as opposed to "invalidates".
- **(f) Metadata and clone boundaries remain honest.**
  - `Sound.clone` copies only `_filters` (`src/sound.ts:167`, `src/sound.ts:196`).
  - `Playback.clone` deep-copies the built biquads into fresh attachments (`src/playback.ts:877-884`). `not-attached` is therefore the truthful result for references taken from the original.
- **(g) Inherited pitch is testable without the deferred public adapter.**
  - The needed tools are a deferred `buildWorkletEffect` and a custom effect exposing `pitchFactor`. The test then makes ownership, unity and cancellation assertions.
  - The current name probe and the double-add race are real (`src/playback.ts:719-745`). The draft's ownership wording addresses both.

## Adjudications

1. **Keep the full metadata migration in #238.** This is coherent, because the PRs are incremental and no consumer imports are needed. Proportionality is acceptable if consumers are not held up until the issue closes. See refinement 5.
2. **Keep stereo pan as an initial adapter.** This is coherent. A per-adapter replacement policy fixes the over-broad rule I flagged. HRTF, `setPanType` and `setPannerNode` are all covered by "switching/replacing".
3. **Keep disposal of separately owned rejected duplicates.** This is coherent with `src/effectChain.test.ts:60-78`. See refinement 1 for a rule the code can apply.

## Optional refinements (not blockers)

1. **Duplicate-handle backstop disposal.**
   - The chain cannot infer who owns a rejected graph.
   - Suggested wording: "The backstop skips disposal only when the rejected result is the admitted record's own graph (same graph object, same dispose callback, or same input/output nodes); any other rejected result is disposed once."
   - This keeps the existing test green, because its duplicate has distinct input/output nodes and its own dispose callback.
2. **Single internal pitch record.**
   - "Cannot insert a stale build" only implies this.
   - Suggested wording: "At most one internal pitch record exists per voice; the latest requested factor wins."
   - Today two concurrent calls chain two phase vocoders in series.
3. **Pitch failures become visible.**
   - They are currently swallowed silently in `preplay` (`src/sound.ts:275-277`).
   - An environment without AudioWorklet will now emit an effect error for every voice. Add this to the changelog note beside the alias change.
   - Also say whether `Playback.clone`'s identical swallow (`src/playback.ts:887-889`) stays silent. I recommend that it does, per "preserve existing clone behavior".
4. **Scope wording.**
   - Write "playback stereo pan", because Bus has no pan control.
   - State that strict preparation on a media-element Sound rejects as `unsupported` before it constructs a voice.
5. **Consumer start point.**
   - Suggested wording: "#45 and #200 may build on PR 1's contract once merged; they need not wait for this issue to close."
6. **Known limitation of effect assignment.**
   - An immediate effect assignment made during a running `rampParam` ramp is absorbed by that ramp. This is existing `setValueAtTime` behaviour and #45 will own it.
   - One sentence in the issue prevents a false bug report.

## Not verified

- I did not check the 17/13/62 inventory count, the CLI registry, the bundle scripts, or the stream rollback line numbers. The stream rollback findings were recorded previously.
- I edited no files, published nothing, and did not delegate.
