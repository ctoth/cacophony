Reviewer: Claude Fable 5.1 (`claude-fable-5-1`, verified from the successful CLI result metadata). External read-only review, 2026-09-18.

## Verdict: REVISE

The ownership model matches the code, and both deferrals are sound. The text needs contract corrections, not a redesign. As written it would introduce one regression, it contradicts itself in one place, and the current `EffectChain` would produce several wrong outcomes.

## The `Sound.play` listener

Yes, effect errors must be distinguishable.

- `Sound.play` removes its pending `play` forwarder on any playback `error` (`src/sound.ts:411-417`).
- Buffer voices emit `play` synchronously (`src/playback.ts:328-330`), so they are safe.
- Media-element voices emit `play` only when `mediaElement.play()` resolves (`src/playback.ts:300-310`). Source-slot builds have already started in `preplay()` (`src/sound.ts:260`).
- If a build rejects first, the forwarder is removed and the Sound never emits `play` for a voice that starts normally.
- `recoverable` cannot discriminate, because the media start rejection is also `recoverable: true` (`src/playback.ts:313-318`).
- The revision also dropped the original issue's "dedicated `errorType`" wording.

Decision:
- Add `errorType: "effect"` and an optional attachment-identity field to `PlaybackErrorEvent` and `SoundErrorEvent` (`src/events.ts:133-149`), forwarded unchanged at `src/sound.ts:363-371`. Otherwise a continuing voice is reported at Sound level exactly like an aborted one (`src/sound.ts:317-324`).
- The `Sound.play` listener tears down only on `errorType === "source"`.
- Emit the event only for source-declared slots. `playback.addEffect()` and `Bus.addFilter()` already reject their returned promise.
- Regression test: a media-element Sound with an async recipe that rejects before media acceptance. Assert that Sound `play` fires once.

## Findings

1. **The missed-deadline clause contradicts the preparation contract.**
   - Preparation "must not start audio itself" and returns the voice for the caller's `play()`. Yet "the prepared-start path fails" on a passed deadline, and acceptance 7 tests that. No API in the text receives a deadline.
   - Today a past `at` starts immediately (`src/playback.ts:329`, `src/playOptions.ts:31`), and that must not change.
   - Prepared values are applied before `play()` is called, so nothing can be applied late.
   - Decision: delete the clause and its test. Callers compare `context.currentTime` to their own deadline after awaiting.

2. **Removal or cleanup while a build is pending would be misreported.**
   - A late `resolve` on a cancelled reservation throws (`src/effectChain.ts:90-93`). The revised `_preparePlayback` would surface that as a failed build plus an error event.
   - On a destroyed chain, `resolve` returns the handle as success (`src/effectChain.ts:83-86`). `_addFilterEffect` then pushes the dead node into `_filters` (`src/basePlayback.ts:60-62`).
   - Decision: removal while pending settles `removed`, and cleanup while pending settles `disposed`. Both dispose the late result once, skip `onBuilt`, and emit no event.
   - Decision: readiness resolves to a status and never rejects, so an unobserved failure cannot become an unhandled rejection. Only strict preparation rejects.

3. **"Pending reordering preserves declaration semantics" is not testable as written.**
   - `setOrder` permutes built entries around reservations held at fixed indices (`src/effectChain.ts:134-140`).
   - `setBypassed` throws for anything unbuilt (`src/effectChain.ts:144-147`).
   - Decision: legacy handle-based reorder keeps that behavior. Slot-based reorder takes a permutation of all slots, including pending ones. Bypassing a pending slot is recorded and applied on resolve.

4. **Readiness ignores the pitch-shift build.**
   - `preplay()` fires `setPitchShift` and forgets it (`src/sound.ts:274-278`). A "prepared" voice on a pitch-shifted Sound can start unshifted and change mid-playback.
   - Decision: strict preparation awaits that build and fails with it.
   - Decision: the pitch node (`src/playback.ts:743-744`) stays an internal chain record, invisible to slot enumeration and addresses.

5. **Replacement invalidation is stated too broadly.**
   - The Binding row makes "target replacement invalidates" universal.
   - Buffer voices recreate their source on every start, including the first (`src/playback.ts:287-288`, `src/playback.ts:501-530`). Under that rule a future playback-rate binding taken from a prepared voice would die on the `play()` that starts it. The owner already re-applies rate across recreation (`src/playback.ts:519`).
   - Decision: effect-slot bindings live until slot removal or owner cleanup. Each owner-level adapter declares its own replacement policy.
   - Stereo pan is the only first-delivery control that needs the rule. Neither #45's acceptance (volume, bus gain, effect parameters) nor #200 consumes it, so defer it with pitch.

6. **The Slot definition omits attachments that exist today.**
   - "One attachment of a recipe" excludes raw Cacophony-built biquads on a Bus (`src/bus.ts:172`) and on a live playback (`src/basePlayback.ts:113-119`).
   - Decision: a slot attaches a recipe or a Cacophony-built node. Raw biquads use the native biquad definition.

7. **Stream sources contradict two statements.**
   - `MediaStreamSound.preplay` and `PcmStreamSound.preplay` have no rollback around `_preparePlayback` (`src/mediaStream.ts:261-288`, `src/pcmStream.ts:333-358`). Their playback constructors have already connected to the route target (`src/mediaStream.ts:61-64`, `src/pcmStream.ts:60-64`), so a synchronous build throw leaks the voice.
   - Only Sound and Synth roll back (`src/sound.ts:289-326`, `src/synth.ts:135-140`).
   - Both stream sources are single-voice: `preplay()` returns `playbacks[0]`. Source edits made after the first `preplay()` therefore never apply until the voice is torn down.
   - Decision: add the rollback in this work, and state the single-voice consequence.

8. **Owner-level writes have two unresolved conflicts.**
   - `play()` applies `panType`, `volume` and `stereoPan` after preparation (`src/playOptions.ts:85-94`). That overrides any owner-level initial value, and `play({ panType })` replaces the panner.
   - Legacy setters cancel scheduled values (`src/volumeMixin.ts:80-86`, `src/bus.ts:125-129`). A second write policy on the same param would let a running fade absorb a set.
   - Decision: prepared initial values cover effect-slot parameters only. Owner-level start values stay in `PlayOptions`.
   - Decision: until #45 lands, owner-gain bindings delegate to the existing setters. Effect-parameter bindings use `rampParam`'s immediate primitive (`src/effectChain.ts:183-186`). #238 adds no ramps.

9. **No failure kind fits a voice that never captured the attachment.**
   - Three cases are uncovered. `Playback.clone()` bypasses `_preparePlayback` (`src/playback.ts:855`), some voices predate the slot, and some voices belong to a foreign source.
   - Decision: in-memory resolution is an identity lookup in the voice's captured-attachment map, and all three cases return one kind (`not-attached`). This also delivers the foreign-source rejection without owner comparison.

10. **Shared-node recipes in two slots.**
    - On a source, the duplicate-handle throw is synchronous, so every `preplay()` would abort.
    - The duplicate path also disposes the entry (`src/effectChain.ts:94-98`). For a recipe that returns one shared graph, that tears down the live first slot and breaks "disposal runs once".
    - Decision: reject at attach time for `ShareEffect`, `BiquadEffect` and third-party recipes that declare sharing. Keep the chain check as a backstop that does not dispose.

11. **Metadata domains are under-specified.**
    - Pin the semantic domain for playback volume. `PlayOptions` requires a value of at least 0 (`src/playOptions.ts:22`), while the volume setter and `Bus.gain` validate nothing.
    - Compare bounds and fixture defaults through `Math.fround`. AudioParams store float32, so a value captured at a bound can otherwise fail strict validation on restore.
    - State that strict rejection and construction-time clamping intentionally differ.
    - I confirmed the proposal's claims on `pitchFactor` (`src/processors/phase-vocoder.ts:53-60`, read at `src/processors/phase-vocoder.ts:94`), on Dattorro preDelay in samples versus FDN in seconds (`src/processors/dattorro-reverb.ts:47`, `src/processors/fdn-reverb.ts:32`), and on the alias fallback to index 0 (`src/effects.ts:440-448`).

## Deferrals

Deferring pitch shift is sound, subject to findings 4 and 5.
- The node is found by probing for a parameter name, and it is removed at unity.
- Two concurrent calls each await a build and then both add a node (`src/playback.ts:719-745`).
- None of that can back a stable binding.

Deferring clone is sound, subject to finding 9 and one further rule.
- `Playback.clone` constructs outside the preparation path and may auto-start (`src/playback.ts:893-895`).
- Rule: legacy `filters` projects only attachments made through `addFilter`, which is the existing `_filterEffectRecipes` distinction (`src/routableSource.ts:29-30`). `Sound.clone` then keeps copying exactly what it copies now (`src/sound.ts:167`, `src/sound.ts:196`).

## Simplifications

- Drop generated names. Unnamed slots have identity only and are reachable by in-memory reference. Acceptance 3's "anonymous/generated" becomes "unnamed".
- Make compatibility identity one address format version, a stable definition id and a parameter key, with no per-definition schema versions.
  - Reserve a `cacophony.` prefix against third-party collisions.
  - State that addresses are owner-relative and that bus-name lookup belongs to #200.
  - Restore the original's exclusion of `master.input.gain`.
- Build preparation as a wrapper over `preplay()` plus a readiness aggregate, not a second construction path. Failure cleanup must remove holdings by identity. The existing rollbacks truncate by captured length (`src/sound.ts:294-297`, `src/sound.ts:433-435`), which is only correct synchronously.
- Let #238 close on the vertical slice plus the contract, and track the full catalog and CLI migration (PR 2) separately. #45 and #200 block on bindings and addresses, not on catalog breadth. Unmigrated effects report `unsupported` in the interim.

## Tradeoffs

- **Effect failures on the `error` event.**
  - Putting them on `error` forwards them to `soundError` for free.
  - It also exposes them to handlers that assume every `error` is a failed source start, which is true today (`src/playback.ts:313`, `src/playback.ts:335`, `src/playback.ts:522`).
  - Widening the union breaks exhaustive switches at compile time.
  - A separate event avoids both problems at the cost of discoverability.
  - I recommend the dedicated `errorType` with a changelog note.
- **Deferring stereo pan.** Replacement invalidation stays unexercised until a follow-up.
- **The sync-throw versus async-reject split.** Preserving it keeps `play()` stable, but abort-versus-continue then depends on whether a recipe's `build` is declared async. Label it legacy compatibility and note that strict preparation fails on both.
- **Splitting the catalog migration.** This adds a second issue to track.

Not verified: the 17/13/62 inventory count, the CLI registry and the bundle scripts. I edited no files. I left `fable-review-1.json` and `fable-review-2.json` in the snapshot directory unread to keep this review independent.
