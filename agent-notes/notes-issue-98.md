# Issue 98 working notes

## Current state

- Branch: `agent/issue-98-audio-graph-assertions`
- Pre-existing untracked `notes-deep-review.md` remains untouched.
- This notes file must remain uncommitted and must not be staged or pushed.
- Commit: `2dac48a75a59a0d3f63b74f8a459486b17b4a928`
- Pull request: `https://github.com/ctoth/cacophony/pull/115`
- PR 115 merged at `2026-07-29T07:20:41Z`.
- Merge commit: `b3b35cc7c0c631589e1aeaeb754e36302be30522`
- Issue 98 closed automatically with state reason `COMPLETED`.
- The repository convention uses merge commits for recent PRs.

## Findings

- Standard mock audio nodes expose `connect` and `disconnect` as observable Sinon call histories.
- `standardized-audio-context-mock` returns bare `{}` objects from
  `AudioContext.createChannelSplitter()` and `createChannelMerger()`, so those
  two factories require the issue-authorized instrumentation in
  `src/setupTests.ts`.
- The global test `AudioWorkletNode` mock already uses observable Vitest mocks.
- The helper must reconstruct active edges after destination-specific and
  blanket disconnects, retain splitter/merger output/input port metadata, and
  emit a JSON-safe snapshot.
- TDD red result: 5 expected failures and 57 passes before implementation.
- Targeted green result: 62 passes.
- Local gates passed: `npx biome ci .`, `npm run typecheck`, `npm run build`,
  and `npm test` with 1,014 tests.
- PR CI is fully green: Lint & Format, Type Check, Test (20), Test (22),
  Test (24), and Build all succeeded.

## Blocker

- No blocker.

## Next action

None. The requested fix, PR, green-CI gate, merge, and issue closure are
complete.
