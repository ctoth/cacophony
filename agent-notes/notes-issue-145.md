# Issue 145 delivery notes

## Findings and implementation

- Confirmed issue #145 is open and contains six paper-cut items.
- Added failing regressions for the send-gain cleanup, default synth detune,
  SynthPlayback lifecycle/global events, all three createStream panning tiers,
  and the public MicrophoneStream export.
- Implemented deterministic send-gain disconnect on connection failure.
- Defaulted Synth.detune to zero.
- Moved global synth lifecycle emission to SynthPlayback while retaining Synth
  container events and avoiding duplicate global notifications.
- Added createStream(url, signal, panType) with HRTF default and threaded it
  through WebCodecs, HLS, and media-element paths.
- Exported MicrophoneStream and documented the linear resampler's lack of an
  anti-aliasing filter in source docs and README.

## Evidence and state

- Red: six focused behavioral failures plus one missing-export failure.
- Green focused: 159 passed, 1 environment-gated skip.
- `npm run lint`: passed.
- `npm run ci:test`: 1,084 passed, 1 skipped, no type errors.
- `npm run build`: passed with the repository's known TS4094 and TypeDoc
  warnings; generated tracked bundle churn was restored before commit.
- Branch: `agent/issue-145-paper-cuts`
- Commit: `54cedbb` (`Fix issue 145 paper cuts`)
- Branch pushed to origin. Existing unrelated untracked notes remain untouched.

## Delivery result

- PR: https://github.com/ctoth/cacophony/pull/152
- Closing phrase: `Closes #145`
- All six required CI jobs passed: Lint & Format, Type Check, Test on Node
  20/22/24, and Build.
- PR #152 merged at `aa86db9ae6cff89ee177bee7abb7a5cfdd222d5d`.
- Issue #145 is closed as completed.
- No blocker or remaining action.
