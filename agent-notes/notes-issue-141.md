# Issue 141

## Current findings

- GitHub issue 141 is open and remains reproducible on current `origin/master`.
- `setGlobalVolume()` wrote directly to `globalGainNode.gain` while muted, making audio audible while `muted` remained true and losing the requested volume on unmute.
- Existing shared `cacophony` test infrastructure is sufficient; no new helper or adapter is needed.

## TDD evidence

- Added `defers setGlobalVolume changes made while muted until unmuting` to `src/cacophony.test.ts`.
- Red run: `npm test -- src/cacophony.test.ts` failed because the gain was `0.5` instead of `0`.
- Implemented the muted guard in `setGlobalVolume()` and preserved mute state/event ordering by applying the internal zero-gain change directly in `mute()`.
- Green targeted run: 74 tests passed.

## Validation

- `npm run lint`: passed.
- `npm run ci:test`: 72 files passed; 1,063 tests passed, 2 skipped; no type errors.
- `npm run build`: passed.
- Build-regenerated bundle artifacts were restored because they are unrelated to issue 141.

## State

- Branch: `agent/issue-141-muted-global-volume`, based on current `origin/master`.
- Intended tracked changes: `src/cacophony.ts` and `src/cacophony.test.ts`.
- Existing `notes-*.md` files and this note remain untracked and must not be staged.
- Blocker: none.

## Delivery

- Commit: `14b0cac` (`Respect mute in global volume changes`).
- PR 149 included `Closes #141`.
- Live CI passed: Lint & Format, Type Check, Test (20), Test (22), Test (24), and Build.
- PR 149 merged as `ac2a68de0f66f6433e0e754962a97aab32c06dd5`.
- Issue 141 is closed.
- Next action: none.
