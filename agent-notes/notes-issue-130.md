# Issue 130 working notes

## Current findings

- GitHub issue 130 is open and not already implemented on `origin/master`.
- Current master includes issue 129's media-element streaming honesty changes.
- Existing production boundaries to reuse:
  - `RoutableSource` for primary routes, sends, and bus drain handling.
  - `BasePlayback` plus the pan, volume, and filter mixins for the playback graph.
  - `TypedEventEmitter` for typed stream events.
  - `WORKLETS` and `Cacophony.createWorkletNode()` for worklet registration and construction.
- Baseline on branch `agent/issue-130-pcm-stream`: 67 test files passed, 1,024 tests passed, 2 skipped, no type errors.

## TDD state

- Red tests were added for:
  - fixed-size PCM ring-buffer behavior;
  - gapless interleaved chunk rendering;
  - stereo deinterleaving;
  - pause/resume without consumption;
  - underrun silence and recovery;
  - latency gating;
  - public factory, routing, volume, pan, backpressure/drain, state events, honest seek/loop errors, and abort cleanup;
  - a real `node-web-audio-api` offline render across a chunk boundary;
  - README capability documentation.
- The targeted red run failed for the intended missing surfaces:
  - missing `pcm-stream-core`;
  - missing `pcmStream` public class;
  - missing `Cacophony.createPcmStreamSound`;
  - missing README contract.
- No unrelated failure appeared in that targeted run.

## Implementation state

- Added the context-free `PcmStreamEngine`.
- Added the `pcm-stream` AudioWorklet shell.
- Added `PcmStreamSound` and `PcmStreamPlayback` using the existing routing/playback/event boundaries.
- Added the PCM worklet entry to `WORKLETS`.
- Added the async `Cacophony.createPcmStreamSound()` public factory and public exports.
- Added README documentation for push PCM, backpressure, capability limits, events, routing, and AbortSignal teardown.
- Extended the existing Node worklet URL resolver so a real offline render can load Vite's source-mode `/src/bundles/...` URL as well as the published `data:` URL.
- Generated the PCM worklet and PCM core bundles.
- Restored unrelated phase-vocoder and timestretch generated churn after each worklet build.

## Blocker

- No external blocker.
- No implementation or validation blocker.
- Publication has not started yet.

## Exact next action

Audit the final intended diff, stage only issue 130 source/tests/docs/generated bundles (excluding every `notes-*.md` file), commit the kept slice, push it, and open a ready PR whose body contains `Closes #130`. Then monitor all required GitHub checks and merge only after they are green.

## Green evidence

- Targeted TDD run: 4 files passed, 21 tests passed.
- Real offline render through `createOfflineNodeCacophony()`: passed and proved a 256-frame audible run across two 128-frame writes.
- Final full typed suite: 70 files passed; 1,038 tests passed; 2 skipped; no type errors.
- Lint: 146 files checked; no errors or warnings.
- Production build: exit 0.
- Build emitted the repository's existing TS4094 declaration-plugin diagnostics and 35 TypeDoc warnings; these did not fail the build.

## Git hygiene

- Preserve all pre-existing untracked `notes-*.md` files.
- Keep this note untracked and out of commits, pushes, and the PR.
