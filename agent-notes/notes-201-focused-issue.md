## Problem

Moving sources and listeners currently write position, orientation and stereo pan as instantaneous steps. Frequent updates can introduce audible motion artifacts.

## Contract

- Add opt-in exponential smoothing for source position/orientation, stereo pan, and modern listener pose setters. Time constants use seconds; default `0` preserves immediate writes. Reject negative/non-finite constants.
- Provide an instance default through `RuntimeOptions.spatialSmoothingTau`, source/voice `spatialSmoothingTau` overrides, and independent `Cacophony.listenerSmoothingTau`. Support the Node factories too.
- Source setting assignments affect current and future voices. Individual voices can override the setting until the next source assignment. Sound, Synth and Playback clones preserve settings and requested poses.
- Initialize new voices and initial `play(options)` poses immediately. Subsequent writes, including while paused, use smoothing. Setting the constant to `0` snaps pending transitions to their requested targets.
- Retarget from the current owned envelope without a jump, prune prior automation, and reuse the existing panner nodes. Spatial getters return requested targets during transitions.
- Partial `threeDOptions` updates leave omitted axes and their automation unchanged, including independently positioned voices receiving unrelated container changes.
- Keep legacy listener `setPosition`/`setOrientation` and custom params without `setTargetAtTime` immediate. Clean up owned automation when a voice is cleaned up or its panner replaced.

Smoothing owns automation on these spatial parameters; callers must not mix it with direct panner-param automation. Orientation components are smoothed independently, rather than providing constant-speed angular interpolation. HRTF parameters operate at control rate: acceptance measures reduced motion artifacts, not sample-perfect continuity.

## Acceptance

- Unit regressions cover default compatibility, scheduling, interrupted retargeting, target getters, partial updates, inheritance/fan-out, cloning, initialization, validation, pause/resume and cleanup across Sound, Synth and stream voices.
- Real offline rendering exercises setters during suspend/resume, verifies an interrupted stereo envelope and a tau change, and demonstrates reduced source/listener HRTF distance-motion discontinuities against the instantaneous control.
- Native browser tests cover target round-trips and modern/legacy listener behavior, plus rendering on engines with offline suspend/resume. Optional Node rendering tests use the existing backend-availability guard and must run in a supported environment.
- README, TypeDoc and changelog document seconds, opt-in defaults, inheritance, target getters and host limitations. The packed-package type consumer exercises the public API.

## Scope

This issue now covers motion smoothing only. Occlusion was delivered independently in #221. Doppler and velocity/rate-composition design are deferred to separate follow-up work and are not prerequisites for this issue.
