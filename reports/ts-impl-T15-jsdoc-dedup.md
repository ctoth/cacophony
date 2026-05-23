# T15 — Strip JSDoc that duplicates TypeScript types

## Commit

`<hash-pending>` — `docs: strip JSDoc lines that duplicate TypeScript types`

## Files changed

- `src/basePlayback.ts`
- `src/container.ts`
- `src/filters.ts`
- `src/group.ts`
- `src/microphone.ts`
- `src/playback.ts`
- `src/sound.ts`
- `src/synth.ts`
- `src/volumeMixin.ts`

Net diff: 31 lines deleted, 0 added.

## Per-file changes

| file | blocks stripped (whole block) | blocks shortened (lines removed inside block) | blocks left intact |
|---|---|---|---|
| `src/basePlayback.ts` | 0 | 1 (isPlaying getter) | 4 (event handlers + fade comments) |
| `src/container.ts` | 0 | 8 (play, addFilter, removeFilter, isPlaying, position get/set, volume get/set) | ~15 (fade methods kept — unit/range/default semantics) |
| `src/filters.ts` | 0 | 2 (addFilter, removeFilter — kept `@throws`) | 0 |
| `src/group.ts` | 0 | 1 (randomSound — kept `@throws`) | ~8 (preplay/play loop docs have substantive "or undefined" prose) |
| `src/microphone.ts` | 0 | 2 (both `isPlaying` getters) | many (unchanged elsewhere) |
| `src/playback.ts` | 0 | 6 (ctor 3 lines, playbackRate get/set, sourceLoop, connect @param, clone @param+@returns) | many (fade methods, outputNode, disconnect — substantive) |
| `src/sound.ts` | 0 | 2 (clone @returns, preplay @returns) | many (substantive duration/seek/loop docs) |
| `src/synth.ts` | 0 | 2 (clone @returns, preplay @returns) | a few |
| `src/volumeMixin.ts` | 0 | 2 (volume get/set) | 3 (fade methods kept) |

No whole JSDoc blocks were deleted; every block retained at least one substantive line (description, `@throws`, `@example`, `@deprecated`, or non-type prose).

## Findings addressed

The "Nits" section of essentially every per-file review report flagged this pattern. Representative citations:

- `reports/ts-review-filters.md`: filters.ts `addFilter`/`removeFilter` JSDoc restates the `BiquadFilterNode` type already in the signature.
- `reports/ts-review-container.md`: container.ts position/volume getter/setter JSDoc restates types (`@param {Position}`, `@returns {number}`).
- `reports/ts-review-playback.md`: playback.ts ctor JSDoc lists each constructor param's type with no added semantics.
- `reports/ts-review-volumeMixin.md`: volumeMixin volume getter/setter `@returns {number}`/`@param {number}` are pure restatement.
- `reports/ts-review-basePlayback.md`: `isPlaying` getter `@returns {boolean} True if...` is vacuous.
- `reports/ts-review-microphone.md`: `isPlaying` getters same vacuous pattern.
- `reports/ts-review-sound.md` / `reports/ts-review-synth.md`: `clone` `@returns {Sound}` / `@returns {Synth}` and `preplay` `@returns {Playback[]}` / `@returns {SynthPlayback[]}` are restatements of the signature.
- `reports/ts-review-group.md`: `randomSound` `@returns A random Sound object from the group` (kept the substantive `@throws`).

## Typecheck

PASS — `npm run typecheck` exits 0 (`tsc --noEmit`).

## Tests

PASS — `npm test` reports 20 test files, **449 tests passed**, 0 failures.

## Lint

PASS — `npx biome ci .` exits 0. 4 pre-existing warnings remain (3 `suppressions/unused` in `sound.test.ts`, 1 `noUnusedImports` for `BiquadFilterNode` in `synth.ts`). All four pre-date this change and are out of scope for T15 (JSDoc-only).

`npx biome format --write` on touched files produced no changes.

## Decisions about what to leave alone (default to caution)

Per the prompt, "when in doubt, leave the JSDoc alone." Substantive content KEPT:

- **Unit info** on `@param` (`"in milliseconds"`, `"in seconds"`) — adds info beyond the type.
- **Range info** (`"between -1 and 1"`, `"0 to 1"`) — invariants not visible from `number`.
- **Default-value notes** (`"Defaults to linear"`) — substantive per the prompt's explicit edge case.
- **Promise semantics** (`"Resolves when the fade completes"`) — describes WHAT the promise carries, not the type.
- **Overload semantics** (`"if no parameter is provided"`) — explains return-value variance.
- **Union-discrimination notes** (`"'infinite' for endless looping"`) — adds info beyond `LoopCount`.
- **Optional / null semantics** (`"or null if stereo panning is not applicable"`, `"If omitted, disconnects from all destinations"`) — substantive behavior.
- **Tuple structure** (`"The [x, y, z] coordinates"`) — expands what `Position` is.
- `@returns Cleanup function` (no type braces) across `eventEmitter.ts` / `cacophony.ts` / `synth.ts` / `basePlayback.ts` / `sound.ts` — non-type prose that explains what the returned function does.
- All JSDoc on `src/cacophony.ts` public API — per prompt, public-facing docs are valuable even if light. **Not touched.**
- All `src/processors/*.ts` — out of scope per prompt.
- `src/cache.ts` JSDoc — every `@param`/`@returns` carries substantive description (HTTP semantics, conditional-request behavior, abort handling). **Not touched.**
- `src/pannerMixin.ts` — every `@param`/`@returns` adds info beyond the type. **Not touched.**

## Out-of-scope observations

- `src/synth.ts:3` — `BiquadFilterNode` is imported but unused. Biome warns `lint/correctness/noUnusedImports`. Pre-existing on `master`. (Verified by stashing changes and re-running biome.) Trivial to remove but outside T15 scope.
- `src/sound.test.ts` has three `// biome-ignore lint/suspicious/noExplicitAny:` suppressions that biome reports as ineffective (`suppressions/unused`). Pre-existing; tests are out of scope for T15.
- `src/cacophony.ts` `createPanner` JSDoc has an `@example` whose asterisks are misaligned (lines 537–542 start with one space + `*` rather than two spaces + `*`). Cosmetic, biome doesn't flag it, and editing it would violate the "do NOT reformat surviving JSDoc" rule. Noted only.

## Deviations from plan

None.
