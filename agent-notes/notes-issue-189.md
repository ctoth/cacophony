# Issue 189 investigation checkpoint

## Findings

- Issue #189 is reproducible on current `master`: the listener setters directly dereference modern `AudioListener` AudioParams that Firefox does not expose.
- Mozilla Bugzilla #1283029 and MDN confirm Firefox still requires deprecated `setOrientation()` and `setPosition()` for `AudioListener` pose updates.
- The hand-written `src/context.ts` contract incorrectly required all nine modern listener AudioParams. The listener unit test reinforced that assumption with a manually idealized object and `as any`.
- `standardized-audio-context` handles the same browser split by feature-detecting `forwardX` and synthesizing params, but Cacophony defaults to the native `AudioContext`.
- Current CI runs Node mock tests only; it has no native Chromium, Firefox, or WebKit compatibility gate.

## Current state

- Local investigation branch `agent/issue-189-firefox-listener` is preserved in commit `36f3ddbd` (`Add native listener compatibility coverage`).
- `gh pr checkout 190` has switched the working tree to contributor branch `bugfix/189-firefox-backwards-compat` at `b329aeb1`; its earlier contributor commit is `1533b772`.
- Added a red regression for a Firefox-shaped listener; confirmed the original `Cannot set properties of undefined (setting 'value')` failure.
- Changed the listener type to an explicit modern/legacy union and added runtime capability narrowing.
- All four public listener pose setters now use modern params when present, otherwise legacy methods, while preserving last-known state for getters and partial orientation updates.
- Focused verification is green: 88 tests across `cacophony.test.ts` and `context.test.ts`; `npm run typecheck` is green.
- Added Playwright native-engine coverage for Chromium, Firefox, and WebKit, plus CI jobs that gate the existing Build job transitively.
- Native results on Windows: Chromium passes the modern path; Firefox passes the legacy path; Playwright WebKit has no `AudioContext` and is explicitly skipped only on Windows. CI/Linux must expose it or fail.
- The browser check also constructs the core required context factories (biquad, buffer source, gain, oscillator, panner, stereo panner, merger, splitter).
- Chromium exposed that `setValueAtTime()` does not provide an immediate `.value` round-trip, so all Cacophony listener getters now consistently return copied last-known state initialized from modern params when present.
- Partial-modern listener unit coverage verifies that an incomplete modern surface falls back atomically to legacy methods rather than dereferencing sibling properties.
- `npm run lint` and the focused unit tests are green. The first full `npm run ci:test` ran 82 Vitest files / 1,134 tests green with no type errors, but failed because Vitest also discovered the Playwright spec. `vite.config.ts` now excludes `browser-tests/**`; the full gate must be rerun.
- After that exclusion, `npm run ci:test` is green: 82 files, 1,134 tests, and no type errors. `npm run lint`, `npm run typecheck`, and `npm run build` are green; build retains the known zero-exit TS4094 and 35 TypeDoc warning baseline.
- `npm run test:browser` is green on native Chromium and Firefox. Windows Playwright WebKit has no `AudioContext` and is skipped locally; Linux CI is configured to require WebKit support.
- PR #190 already has strong mocked modern/Firefox fallback tests and a two-commit contributor implementation. Compared with the local work, it lacks native-engine CI, does not atomically reject partially modern listener shapes, and reads modern AudioParams back immediately even though Chromium demonstrated that scheduled `setValueAtTime()` values are not reliable for immediate getter round-trips.
- Selective integration onto the PR branch is committed as `3f513650`: contributor commits `1533b772` and `b329aeb1` remain intact, followed by one additive hardening/browser-coverage commit.
- The combined tree is green: focused 92 tests; full 82 files / 1,138 tests / no type errors; lint and standalone typecheck clean; build exits zero with the known TS4094 and 35 TypeDoc warnings; native Chromium and Firefox pass while Windows WebKit is skipped because it lacks `AudioContext`.
- Direct fast-forward push to `ScionOfDesign/cacophony:bugfix/189-firefox-backwards-compat` was rejected with `permission denied`. Live PR metadata confirms `isCrossRepository: true` and `maintainerCanModify: false`.
- The verified combined head is safely pushed to `ctoth/cacophony:agent/issue-189-firefox-listener-upgrade` at `3f513650` without opening or replacing a PR.
- Per user direction, PR #190 was normal-merged as `bd67c18c` with parents `cd43fe66` and `b329aeb1`; issue #189 closed immediately afterward.
- The additive commit was rebased onto that merge as `1692ce2d` on `agent/issue-189-listener-compat-followup`, and ready PR #191 was opened.
- PR #191 exact-head run `31752131838` exposed a clean-checkout browser prerequisite bug: Vite cannot resolve ignored/generated `src/bundles/*-bundle.js` files, so `window.runListenerCompatibilityCheck` is never installed. Local browser runs had inherited bundles from earlier unit/build commands.
- Added separate commit `82930de1` (`Build worklets before browser tests`) so the npm lifecycle generates worklets before Playwright in every environment.
- Replacement exact-head run `31752300602` passed Lint & Format, Type Check, Node 20/22/24 tests, Chromium/Firefox/WebKit browser compatibility, and Build.
- PR #191 normal-merged as `7d194f10` with parents `bd67c18c` and `82930de1`; the follow-up head is an ancestor of `origin/master`. Issue #189 remains closed.
- User-owned `notes-*.md` files remain untouched. This note must remain uncommitted and unstaged.

## Blockers

- No task blocker. Post-merge master CI/docs runs started automatically; all requested PR-head checks and merge proofs are complete.

## Next action

- Report both normal merges, exact CI evidence, issue closure, and preservation of all untracked `notes-*.md` files.
