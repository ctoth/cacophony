# Microphone issues #102 and #110

## Findings

- `Cacophony.getMicrophoneStream()` constructed the legacy `MicrophoneStream` without the master/global gain output, so monitoring bypassed global volume, mute, master effects, and metering.
- The old microphone implementation duplicated media-stream playback with no BasePlayback state machine or event emitter, swallowed internal `getUserMedia` errors, hardcoded HRTF panning, and did not disconnect its source on stop.
- `MediaStreamSound` already provides the intended BasePlayback lifecycle, routing, effects, panning, event, and cleanup behavior.

## Current state

- Branch: `agent/microphone-modernization`, based on `origin/master` at `aa86db9`.
- Added red acceptance coverage for async rejection, master routing, stereo panning, lifecycle events, and graph teardown; the legacy implementation failed all five.
- Replaced `src/microphone.ts` with a thin `MediaStreamSound` specialization and public async `MicrophoneStream.request()` factory.
- `Cacophony.getMicrophoneStream(options)` now forwards acquisition options and routes playback to `globalGainNode` / `master.input`.
- `MicrophoneStreamOptions` exposes media constraints, pan type, stereo pan, and initial HRTF options.
- README documents error rejection, options, master routing, events, and cleanup.

## Verification

- Focused: `src/microphone.test.ts` and `src/mediaStream.test.ts`: 26 passed.
- `npm run lint`: passed.
- `npm run ci:test`: 74 files, 1,074 tests passed, no type errors.
- `npm run build`: passed with the pre-existing TS4094 and TypeDoc warnings.
- Build regenerated tracked artifacts; inspect and restore unrelated generated changes before staging.

## Blocker

- None currently.

## Next action

- Review the scoped diff and generated artifacts, stage only intended source/test/docs files, commit, push, open a PR with `Closes #102` and `Closes #110`, watch all CI checks to green, merge, and verify both issues closed.
