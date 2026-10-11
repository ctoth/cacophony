# Library replacement evaluation — 2026-09-12

- Auditing seven named candidates at Cacophony HEAD 665b33251d5c9597943c77a9d71dd2e81a2c92a6; no implementation changes authorized or made.
- Isolated probes in C:/Users/Q/AppData/Local/Temp/cacophony-library-eval-20260912 reproduce cached no-store responses, unsuppressed resampling aliasing, EventEmitter3 reentrant once duplication, and wavefile PCM16 rounding differences.
- automation-events 7.1.19 passes timeline probes; 8.0.1 conflicts with the supported Node range. Signalsmith 1.3.2 shifts 440 Hz to 880 Hz in Chromium/Firefox offline rendering, with 120 ms default latency; local WebKit lacks OfflineAudioContext.
- Existing issues #45 (automation), #167 (emitter), #206 (normalization), #208 (export) reviewed for overlap. DSP packaging/API compatibility still under evaluation.
- Next: finish host/contract checks, write final decisions with limitations, and publish concrete issues for go decisions without duplicating existing scope.

## Decision checkpoint
- GO: automation-events 7.1.19 in existing #45, http-cache-semantics in new #229, and Rubato 5.0.0 WASM sinc resampling in new #230.
- NO-GO now: Signalsmith published package (Node/global and synchronous API mismatch), libebur128 production migration (unproven benefit plus public/worklet integration), wavefile, EventEmitter3.
- Rubato WASM ran successfully; 18 kHz stopband fixture suppression was ~150.5 dB. http-cache-semantics 4.2.0 freshness regression reproduced; 4.1.1 passes, upstream PR #54 tracks the fix.
- Full decision report and reproducible probes retained under reports/library-replacement-evaluation-2026-09-12.md and reports/library-evaluation-2026-09-12/. No implementation/dependency changes, commits, or merges.
- Remaining action: verify published issue bodies and final repository diff, then report results.
