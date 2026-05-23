# TS impl T7 — remove non-null `!` assertions

## Commit

`<pending>` — refactor(types): remove non-null assertions in favor of explicit guards

## Files changed

- `src/basePlayback.ts` — removed `origin!` definite-assignment, accept `origin` in constructor
- `src/oscillatorMixin.ts` — replaced 6 `this.source!` accessor sites with explicit guards
- `src/synthPlayback.ts` — removed 2 `!` from constructor by capturing locals after setter calls; super() now passes origin
- `src/playback.ts` — super() now passes origin (internal call-site update)
- `src/mediaStream.ts` — super() now passes origin (internal call-site update)

## Findings addressed

- `reports/ts-review-basePlayback.md` (Blocker, `src/basePlayback.ts:13`): `origin!: PlaybackContainer` removed — replaced with constructor injection. Subclasses now call `super(origin)` and the field is genuinely non-nullable from construction onward.
- `reports/ts-review-oscillatorMixin.md` (Blocker, `src/oscillatorMixin.ts:54, 58, 63, 67, 72, 76`): five `!` sites (six lines) on `this.source!.X` replaced with explicit `if (!this.source) throw new Error("No source node found");` guards. Mirrors the existing pattern in `play()` (L30-32).
- `reports/ts-review-synthPlayback.md` (Blocker, `src/synthPlayback.ts:27, 29` — actual lines 22, 24 in current code): two `!` sites removed. After `setPanType`, the panner is captured into a local `const panner = this.panner` with an explicit guard. `setGainNode` is also called and the constructor-provided `gainNode` parameter (already non-nullable) is used directly in the subsequent `panner.connect(gainNode)` rather than re-reading `this.gainNode!`.
- `reports/ts-review-volumeMixin.md`: NO `!` sites remained in `src/volumeMixin.ts` — the prior Bug-volumeMixin refactor already removed them via the `_activeFade` discriminated state and local node-capture pattern. Nothing to do.
- `reports/ts-review-pannerMixin.md`: NO `!` sites exist in `src/pannerMixin.ts`. The file uses `as` casts for `StereoPannerNode`/`PannerNode` narrowing (out of T7 scope) but no non-null assertions. Nothing to do.

## Per-site disposition

| Site | Disposition | Note |
| --- | --- | --- |
| `src/basePlayback.ts:13` `origin!` | REMOVED | Constructor now accepts `origin: PlaybackContainer`; assigned in body. |
| `src/oscillatorMixin.ts:54` `this.source!.frequency.value` (get) | REMOVED | Explicit guard added. |
| `src/oscillatorMixin.ts:58` `this.source!.frequency.value =` (set) | REMOVED | Explicit guard added. |
| `src/oscillatorMixin.ts:63` `this.source!.detune.value` (get) | REMOVED | Explicit guard added. |
| `src/oscillatorMixin.ts:67` `this.source!.detune.value =` (set) | REMOVED | Explicit guard added. |
| `src/oscillatorMixin.ts:72` `this.source!.type` (get) | REMOVED | Explicit guard added. |
| `src/oscillatorMixin.ts:76` `this.source!.type =` (set) | REMOVED | Explicit guard added. |
| `src/synthPlayback.ts:22` `this.source.connect(this.panner!)` | REMOVED | Local capture + explicit guard after `setPanType`. |
| `src/synthPlayback.ts:24` `this.panner!.connect(this.gainNode!)` (both `!`) | REMOVED | Reuses captured `panner` local; reuses the constructor `gainNode` parameter directly. |

## Deferred (`// XXX T13` comments added)

None. Every `!` in the assigned files was removable without the T13 state-machine refactor. The split-brain risks called out in the reports (e.g. `_state` vs `_playing` vs `source` in `synthPlayback`) remain real but the `!` operator itself was not load-bearing on any of them — the surrounding guards already establish narrowing at each access site, or the value is provably present (constructor-just-created).

## Typecheck

PASS (`npm run typecheck` -> `tsc --noEmit`, no output).

## Tests

PASS — 449 tests across 20 test files (`npm test`).

## Out-of-scope observations

- `src/playback.ts:85, 87` still contain `this.panner!` and `this.gainNode!` in the constructor, same shape as the synthPlayback fix.
- `src/mediaStream.ts:40, 41, 42` still contain three `!` sites in the constructor.
- Both of those files are outside T7's assigned set. They would benefit from the same local-capture-after-setter pattern, but a future ticket should own them — touching them here would encroach on other waves.
- The `oscillatorMixin.ts:13` `public declare source?: OscillatorNode` re-narrows the inherited `BasePlayback.source: AudioNode | undefined`. The accessors now throw cleanly when `source` is absent (an improvement), but the underlying contract violation called out in `reports/ts-review-oscillatorMixin.md` (the mixin is a "lie" since `TBase` is unused and it always extends `BasePlayback`) is unchanged. That's T13/architectural territory.
- `basePlayback.ts` retains `public source?: AudioNode`, `_playing: boolean = false`, and the `abstract play(): [this]` tuple shape — all flagged in the review but unrelated to `!`.

## Deviations from plan

None. The prompt instructed "remove vs defer-with-comment honestly — do not remove a `!` that's actually load-bearing." Every site was honestly evaluable as removable. Internal call-site updates (`playback.ts`, `mediaStream.ts` `super(origin)`) are explicitly in-scope per the template ("public-API shape change... update any internal call sites broken by the change. Internal call-site updates are in-scope.") since adding a required constructor parameter to `BasePlayback` breaks every subclass `super()` call.
