# Issue 144 handoff

## Findings

- GitHub issue #144 is open: `createSound(urls[]) format fallback always fails on the Node backend`.
- On Node, `Cacophony.canPlaySource()` catches the missing `Audio` global and returns `false`, so no candidate reaches fetch or decode.
- The requested behavior is to treat candidates as playable only when the `Audio` probe is unavailable; a present probe returning `""` must retain the browser-path rejection behavior.
- `Cacophony.isDecodeError()` currently accepts only `DOMException` values named `EncodingError`.
- The existing real-backend suite is `src/node.test.ts`, gated by `describe.skipIf(!nodeBackendAvailable)`.
- The existing valid audio fixture is `test.ogg`.

## Current state

- Branch: `agent/issue-144-node-url-fallback`, created from current `origin/master`.
- Pre-existing untracked `notes-*.md` files remain untouched.
- Added a regression in `src/node.test.ts`.
- The test uses the real Node audio backend and decoder, mocks only `fetch`, returns invalid bytes for an `.mp3` URL, and returns `test.ogg` bytes for an `.ogg` URL.
- The test first failed because both candidates were classified as unsupported before fetch.
- Added the minimal production change in `Cacophony.canPlaySource()`: return `true` only when `typeof Audio === "undefined"`.
- The focused real-backend test then passed without changing `isDecodeError()`. Since that gate accepts only `DOMException` named `EncodingError`, the integration result verifies that `node-web-audio-api` uses the expected decode-error shape for the invalid bytes.
- Existing browser-path tests remain green.
- Local gates passed:
  - `npm test -- src/node.test.ts`: 4 passed.
  - `npm test -- src/cacophony.test.ts`: 73 passed.
  - `npm run lint`: passed.
  - `npm run ci:test`: 72 files passed, 1059 tests passed, 2 skipped, no type errors.
  - `npm run build`: passed.
- The build rewrote four unrelated tracked bundles; those exact build byproducts were restored before staging.
- Commit: `0fd28137c796a030dbdbb963a3ca4d63c03874ff` (`Fix Node URL format fallback`).
- Only `src/cacophony.ts` and `src/node.test.ts` were committed and pushed.
- PR #146 was opened ready for review: https://github.com/ctoth/cacophony/pull/146
- PR #146 targets `master` and its body contains `Closes #144`.
- All six CI checks passed: Lint & Format, Type Check, Test (20), Test (22), Test (24), and Build.
- PR #146 merged at `2026-07-30T07:32:11Z`.
- Merge commit: `17564234bc294672949a592570445a0113889bf2`.
- Issue #144 closed automatically as completed at `2026-07-30T07:32:12Z`.

## Blocker

- None. The requested implementation, PR, green CI gate, merge, and issue closure are complete.

## Next action

- None for issue #144.

## Delivery requirements

- Keep this note uncommitted.
- Run the repository gates before publication.
- Open a PR whose body contains `Closes #144`.
- Merge only after all required PR checks pass.
