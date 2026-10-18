Reviewer: Claude Code (Anthropic), model Claude Opus 5.5 (`claude-opus-5-5`).

# Review of Cacophony #104: commit ce0986ab against origin/master 6a6acda0

**Scope checked:** `merge-base HEAD origin/master` is 6a6acda0, which matches the stated base. The range holds one commit, ce0986ab, touching the 12 listed files. I read the full non-test diff, `src/spatial-controls.test.ts`, `src/AGENTS.md` and the relevant callers: Sound, Synth and Playback `clone`; Sound, Synth, MediaStream and PCM `preplay`/`play`; Microphone; Group; SynthGroup; and the cleanup and origin-removal paths. There is no `CLAUDE.md` in the worktree. I did not run the tests or builds because this session was read-only. The validation results in the brief are the author's report, not something I reproduced.

## What the change gets right (checked against the code)

- **Issue #104 itself is fixed.** `PlaybackContainer._validateSpatialOptions` (`src/container.ts:117-121`) checks the source's mode and then every voice's mode, plus whether the voice is cleaned up. All three container setters call it before writing anything (`container.ts:215, 236, 254`). Mixed modes are rejected in either order because every voice is checked before any write.
- **Direct voice setters and `play(options)` share one validator.** `validateSpatialOptions` in `src/playOptions.ts:59` serves both. `applyPlayOptions` no longer duplicates the position handling, because the panner's `threeDOptions` setter now applies `options.position` itself (`pannerMixin.ts:250`). That also fixes an old gap: `voice.threeDOptions = { position }` used to ignore the position.
- **The validator covers the native setters' constraints.** That means `refDistance`/`rolloffFactor` ≥ 0, `maxDistance` > 0, `coneOuterGain` in [0, 1], integer `channelCount` of 1–2, and `channelCountMode` ≠ `"max"`, all checked before the first panner field is written. A single voice therefore can't be half-applied.
- **Input ownership holds.** The container merges only keys present in `defaultHrtfThreeDOptions`. `position` is not one of them, and the tuple is copied into `positionX`/`Y`/`Z`, so the caller's array is never aliased.
- **Smoothing is unchanged.** All writes still go through `writeSpatialParam`.
- **Group preflight is complete.** `Group.position`, `SynthGroup.stereoPan` and `SynthGroup.position` validate every member, and each member's voices, before writing anything. These are the only group spatial setters that exist.
- **The Synth clone mode-change fix is correct.** `synth.ts:97` now copies the source's HRTF configuration only when the clone is also HRTF.
- **The type change matches the contract.** The CHANGELOG lists it as breaking, and `check-published-types.mjs` uses `@ts-expect-error` to prove a stereo-shaped `ThreeDOptions` no longer type-checks.

## Findings

### F1. Medium (recommended): `Synth.clone` now throws on overrides that `Sound.clone` silently drops
- **Where:** `src/synth.ts:95-96`, compared with `src/sound.ts:188-198`.
- **Scenario:** `hrtfSynth.clone({ panType: "stereo", threeDOptions: { refDistance: 2 } })` throws "Position and threeDOptions require HRTF panning". The same call on a Sound returns a stereo clone and quietly ignores `threeDOptions`. Before this PR, both succeeded. `Playback.clone` (`playback.ts:880-887`) validates only the overrides that fit the target mode and drops the rest.
- **Consequence:** The same `PanCloneOverrides` object gives three different behaviours across three clone paths. The Synth behaviour changed here without a test or a CHANGELOG line, and the "clone mode changes remain explicit and work" item doesn't cover it.
- **Smallest correction:** Pick one rule and apply it to all three clones. The rule closest to the contract is to reject incompatible overrides before allocating anything: call `validateSpatialOptions({ stereoPan, position, threeDOptions }, panType)` on the overrides at the top of each `clone`. Add one test per clone path. Gating Synth like Sound would also restore parity, but silently dropping overrides runs against the PR's own principle.

### F2. Low–medium (recommended): `Synth.clone` stores `stereoPan` without validation
- **Where:** `src/synth.ts:91` (`clone._stereoPan = stereoPan`). This code is unchanged by the PR, but it bypasses the rule the PR establishes.
- **Scenario:** `synth.clone({ panType: "stereo", stereoPan: 5 })` succeeds. Every later `clone.play()` then throws a RangeError from `createPlayback` (`synth.ts:134`), because the stored default is invalid.
- **Consequence:** This is the "silently stores unusable defaults" failure from #104, reached through a different write path. `Sound.clone` goes through the validated setter (`sound.ts:197`) and is safe.
- **Smallest correction:** Validate before storing, using F1's up-front check or by assigning through `clone.stereoPan = stereoPan` when `panType === "stereo"`. Add a regression test.

### F3. Low (optional): an empty `Group` accepts any position, and `_position` aliases the caller's array
- **Where:** `src/group.ts:209-212`.
- **Scenario:** `new Group().position = [NaN, 0, 0]` succeeds because there are no members to validate, and the getter then returns NaN. Separately, `const p = [1, 2, 3]; group.position = p; p[0] = 9;` changes `group.position`.
- **Consequence:** These are small gaps in "invalid value rejects" and "input ownership" on a setter this PR modified.
- **Smallest correction:** Export and call `validatePosition` before the member loop, then store `[...position]`.

### F4. Note (no change needed): documented behaviour changes reviewers should accept knowingly
- **Cleaned voices block source setters until `stop()`.** `SynthPlayback.cleanup` (`synthPlayback.ts:87`) and `Playback.cleanup` don't remove the voice from `origin.playbacks`. So after an explicit `voice.cleanup()`, every spatial setter on the source rejects until the source is stopped. The old code threw too, but only after mutating state. The new behaviour matches the contract and is tested (`spatial-controls.test.ts:125`). Pruning cleaned voices from `playbacks` would be the better long-term fix, but it belongs in a separate issue.
- **Stream reuse.** `stream.play({ panType: "stereo" })` on an HRTF stream switches the single reused voice. After that, both `stream.stereoPan` and `stream.position` reject (the source is HRTF, the voice is stereo), and users have to control the voice directly. This matches the README guidance, but no test covers it. One stream regression would pin it.
- **Negative cone angles are now rejected by direct setters.** `voice.threeDOptions = { coneInnerAngle: -10 }` now throws. The native API accepts negative angles, and `play` options already rejected them. This is the cost of sharing one validator. It's acceptable, but the CHANGELOG's "invalid values" wording covers it only implicitly.
- **`panType` is declared `readonly` on the container but is mutable on Sound and Synth.** It's a public constructor field there, and existing tests reassign it (`synth.test.ts:312`, `play-options.test.ts:186`). Validation reads the live value, so the runtime is correct, but the `abstract readonly` declaration overstates the guarantee. MediaStream and PCM `panType` also went from private to public `readonly`. That widens the API surface (it isn't breaking) and the CHANGELOG doesn't mention it.

### Missing tests
- Clone overrides that conflict with the target mode, for Sound, Synth and Playback (F1).
- An invalid `stereoPan` passed to `clone` (F2).
- A stream source after a `play({ panType })` override (F4).

## Verdict: REQUEST CHANGES

The core of #104 is correct and well covered. Every spatial broadcast is fully validated before it mutates anything, the shared validator matches the native setter constraints, and group preflight is complete. Two things still block approval, and both are small:

1. **F1:** the PR introduces a new, untested and undocumented behaviour split between `Synth.clone` and `Sound.clone` on incompatible spatial overrides.
2. **F2:** `Synth.clone` remains a path that stores an invalid stereo default, which is the exact defect class #104 targets.

Both are fixed by one up-front `validateSpatialOptions` call in the clone paths, plus tests. F3 and F4 are optional.
