# Issue 99 handoff

## Goal

Resolve GitHub issue #99 with TDD, open a PR, watch CI, and merge the PR when green.

## Repository state

- Branch: `agent/issue-99-graph-wiring-tests`
- Base: refreshed `origin/master` at `8b6958c`
- Test commit: `853892632b716636380e6693cbe70df29307ca9e`
- PR: `#119` (`https://github.com/ctoth/cacophony/pull/119`)
- Merge commit: `7809408f5bd1b1f3f45adaf7776b9a286c505034`
- Existing untracked user notes are preserved and must not be staged:
  - `notes-deep-review.md`
  - `notes-docs-workflow-fix.md`
  - `notes-issue-98.md`
- This file must also remain untracked and uncommitted.

## Findings

- Issue #98 is merged and provides `expectReachable`, `expectNotReachable`, and `expectPath` in `src/setupTests.ts`.
- Issue #99 is still valid: the named suites largely assert properties or spy calls rather than live graph reachability.
- The separate known defects named by issue #99 are:
  - #100: `Playback.clone()` produces silent, orphaned clones.
  - #101: `setPanType` after construction orphans the panner chain.
  - #102: `Cacophony.getMicrophoneStream()` bypasses the master bus.
- Pre-change targeted baseline passed: 8 files, 252 tests.

## TDD state

- Graph assertions now cover playback, synth/SynthPlayback, media-stream, bus filter/send wiring, Sound/Synth route and send wiring, bus drain rewiring, Sound preplay wiring, and microphone output routing.
- The exact unskipped red run finished with 276 passing assertions and four genuine product failures:
  - #100: clone output does not reach the destination.
  - #101: changing pan type leaves the source disconnected from the replacement panner.
  - #102: `Cacophony.getMicrophoneStream()` connects directly to the context destination instead of master input.
  - #41-linked synth gap: cloned filters are present in `SynthPlayback.filters` but are not inserted into its audio path.
- Those four regressions are now separate `it.skip` acceptance tests with issue numbers; previously passing property coverage remains active.
- Targeted green run: 9 files passed, 277 tests passed, 4 tests skipped.
- No production code has been changed.

## Current blocker

No blocker.

## Next action

Complete. PR #119 passed all GitHub checks (`Lint & Format`, `Type Check`, Node 20/22/24 tests, and `Build`) and merged into `master`. Issue #99 closed automatically. No further action is required for issue #99; the four skipped tests remain as gates for #100, #101, #102, and the #41-linked synth-filter wiring gap.
