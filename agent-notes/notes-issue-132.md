# Issue 132 handoff

## Current state

- Repository: `ctoth/cacophony`
- Branch: `agent/issue-132-hls-support`, created from current `origin/master`
- Pre-existing untracked `notes-*.md` records are user-owned and must remain uncommitted
- GitHub issue 132 is open: “Optional hls.js adapter for HLS in the media tier”
- `hls.js` 1.6.16 is now declared as an optional peer and dev-only test/typecheck dependency; it is not a hard runtime dependency.
- The local adapter file is being renamed from `src/hls.ts` to `src/hlsAdapter.ts` because TypeScript resolved the external `hls.js` specifier back to the colliding local basename.
- Kept slice committed as `77d6614` (`Add optional hls.js streaming support`).
- The commit contains exactly 11 issue files; no `notes-*.md` file was staged or committed.
- Branch pushed as `origin/agent/issue-132-hls-support`.
- PR 138 merged: https://github.com/ctoth/cacophony/pull/138
- Merge commit: `cf7d84deaa67da72acb0bf54fbae8784ce0269e5`
- The PR body contains `Closes #132`.
- Issue 132 is confirmed closed: https://github.com/ctoth/cacophony/issues/132

## Verified issue requirements

- `.m3u8` through `createStream()` must use native HLS when the media element reports support.
- Without native HLS, installed `hls.js` must attach to the prepared audio element.
- Without either path, reject with an explicit install/direct-stream guidance error.
- Declare `hls.js` as an optional peer without adding it to hard runtime dependencies.
- Map hls.js errors into the library event system and detach/destroy the hls.js instance during cleanup.
- Update README HLS documentation to match behavior.

## Current implementation findings

- `Cacophony.createStream()` currently tries WebCodecs and falls back to the private `createMediaSound()`.
- `createMediaSound()` prepares an `Audio` element, waits for `loadedmetadata`, and passes the prepared element into `Sound`.
- `Sound.cleanup()` already tears down its prepared media element and all playback/media holdings.
- `Sound` already exposes `soundError` through its typed event emitter and maps playback errors into that event.
- `src/node.ts` contains the existing optional-backend dynamic-import/error-guidance pattern.
- `package.json` currently has `standardized-audio-context` as an optional peer and `node-web-audio-api` as an optional dependency; `hls.js` is absent.
- README currently says cross-browser HLS requires a future adapter tracked by issue 132.
- The shared Audio mock already supports listener registration, metadata dispatch on `load()`, and media teardown primitives.

## TDD evidence

- First red test: `createStream uses native HLS when the media element supports it`
  - Failed because `canPlayType("application/vnd.apple.mpegurl")` had zero calls.
- Expanded red run: four focused HLS tests all failed against the old implementation:
  - no native MIME detection
  - no hls.js instance/attachment
  - no error mapping
  - unsupported HLS hung waiting for metadata
- Current targeted run passes all four HLS tests:
  - `npm test -- src/cacophony.test.ts -t "HLS|hls.js"`
  - Result: 4 passed, 67 skipped
- Full issue-focused run after documentation and package coverage:
  - `npm test -- src/cacophony.test.ts src/hls.test.ts src/stream-control.test.ts src/cli/package.test.ts`
  - Result: 82 passed
- Optional-peer bundle externalization was first demonstrated red, then passed after adding `pkg.peerDependencies` to Vite's external list.

## Implemented tracked changes

- Added a small `HlsAdapter` that lazily imports the optional peer, checks MSE support, loads and attaches the source according to the hls.js documented sequence, translates hls.js errors, and idempotently detaches/destroys.
- `.m3u8` `createStream()` calls now choose native HLS via `canPlayType` or the hls.js media-element path before considering WebCodecs.
- `createMediaSound()` reuses the existing prepared-media lifecycle for hls.js and handles load, abort, fatal pre-load error, post-load error, and cleanup paths.
- `Sound.reportLoadError()` routes adapter failures through the existing typed `soundError` event.
- `Sound.cleanup()` invokes the prepared-media cleanup callback before clearing the media element.

## Blocker

- None. The TypeScript module-resolution collision was corrected by renaming the local file and updating its imports.

## Gate status

- `npm run lint`: passed after the final filename/import correction.
- `npm run ci:test`: passed after the final correction, 72 files; 1,056 tests passed, 2 skipped; no type errors.
- `npm run build`: passed after the final correction.
  - Vite surfaced the repository's existing TS4094 declaration warnings.
  - TypeDoc completed with 0 errors and 36 warnings.
- Built ESM retains external `import("hls.js")`; built CJS retains external `await import(\`hls.js\`)`, confirming the optional peer is not bundled.
- `git diff --check`: passed before commit.
- GitHub checks all passed before merge:
  - Lint & Format
  - Type Check
  - Test (Node 20)
  - Test (Node 22)
  - Test (Node 24)
  - Build

## Next action

- None. Delivery, green CI, merge, and issue closure are complete.

## Required delivery

- Keep this notes file uncommitted.
- Run the repository gates (`npm run lint`, `npm run ci:test`, `npm run build`).
- Push the scoped branch, open a PR with a `Closes #132` phrase, wait for all CI checks to pass, and merge only when green.
