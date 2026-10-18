# Issue 107 working notes

## Current state

- User request: resolve GitHub issue 107 with end-to-end TDD, reuse existing helpers where appropriate, open a PR with a closes phrase, wait for green CI, and merge.
- Branch: `agent/issue-107-context-scoped-cache`, created from refreshed `origin/master` at `64d5efb`.
- Tracked worktree was clean before branching.
- Pre-existing untracked `notes-*.md` files remain untouched. This file must also remain uncommitted.
- GitHub CLI 2.87.3 is authenticated as `ctoth` with `repo` and `workflow` scopes.
- Issue 107 is open: `AudioCache static caches are shared across instances and audio contexts`.

## Findings

- The issue remains reproducible on current `origin/master`.
- `src/cache.ts` has static URL-keyed `pendingRequests`, `pendingCallbacks`, and decoded-buffer LRU state.
- `AudioCache.getAudioBuffer()` reads and writes the static decoded-buffer LRU.
- Pending request aggregation is static and keyed only by URL.
- `AudioCache.clearMemoryCache()` replaces the static LRU and clears both static pending maps.
- The public `Cacophony.clearMemoryCache()` delegates to its cache.
- Each normal `Cacophony` constructs its own `AudioCache`, but an `AudioCache` can also receive different contexts through its public method; the issue requires decoded and pending state to be context-aware and clearing to remain instance-scoped.
- Existing cache tests live in `src/cache.test.ts`; existing public loading integration tests live in `src/integration.test.ts`.
- Existing `src/cache.test.ts` has an `audioBufferShape()` helper for LRU byte-estimation tests. It is not a suitable substitute for the end-to-end public Cacophony path required here.
- Existing test setup exports `audioContextMock` and `cacophony`, but that global `cacophony` uses a mocked cache. New acceptance coverage must construct real default-cache `Cacophony` instances rather than reuse `mockCache`.
- Prior repository record says normal gates are `npm run lint`, `npm run ci:test`, and `npm run build`; these still need live verification from current `package.json`.

## Blocker

- None. The implementation is merged and issue 107 is closed.

## Next action

- None for issue 107.

## TDD and implementation evidence

- Baseline `npm test -- src/integration.test.ts`: 6/6 passed before edits.
- Added two public-path integration tests using real default-cache `Cacophony` instances:
  - concurrent same-URL loads on 48 kHz and 44.1 kHz contexts must decode independently;
  - clearing instance A must not evict instance B's decoded entry.
- Red run: both new cases failed exactly as issue 107 predicts:
  - instance B received instance A's 48 kHz buffer;
  - instance B decoded twice after instance A cleared.
- Production change is limited to `src/cache.ts`:
  - decoded LRUs, pending promises, and pending progress callbacks are now WeakMaps keyed by `BaseContext`;
  - those WeakMaps belong to each `AudioCache` instance;
  - context-dependent fetch/progress methods are instance methods;
  - raw browser cache utilities remain static and URL-keyed;
  - `clearMemoryCache()` replaces only the receiving instance's WeakMaps.
- Green rerun of the exact red file: 8/8 passed.
- Green cache-focused run: 59/59 passed across `src/cache.test.ts`, `src/cache.progress.test.ts`, and `src/integration.test.ts`.
- Tightened the first end-to-end case to share one real `AudioCache` between both Cacophony instances, proving the state is context-keyed rather than merely instance-keyed; the test remained green.
- Final local gates:
  - `npm run lint`: passed across 140 files.
  - `npm run ci:test`: 67 files passed, 1,027 tests passed, 2 skipped, no type errors.
  - `npm run build`: exited successfully with the repository's existing declaration-plugin TS4094 diagnostics and TypeDoc warnings.
- Commit: `b62b092a64735a6fee00fb4c1e7930cd39788cdd` (`Scope audio cache state by context`).
- PR: https://github.com/ctoth/cacophony/pull/124
- PR body includes the exact closing phrase `Closes #107`.
- GitHub CI passed: Lint & Format, Type Check, Test on Node 20/22/24, and Build.
- PR 124 merged at `2026-07-29T19:03:47Z`.
- Merge commit: `1f716cf26b065fe82f84e7a4a2b03d18e31bc7a5`.
- Issue 107 closed automatically by PR 124 at `2026-07-29T19:03:48Z`.
