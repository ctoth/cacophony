# C1 Loudness Audit Report

## VERDICT

FAIL for the worklet path: `src/processors/loudness-meter.ts` does not model or exclude LFE, so a 5.1 input can count the LFE channel as programme loudness. The context-free loudness core's 48 kHz K-weighting constants, channel weights, -0.691 offset, two-stage gate, and the 48 kHz true-peak FIR constants match the BS.1770-5 page images I read.

Targeted tests passed:

```text
npm test -- src/meters/loudness-core.test.ts src/meters/truepeak-core.test.ts src/meters/loudness-meter.test.ts src/processors/loudness-meter.test.ts --run
Test Files 4 passed (4); Tests 43 passed (43); Duration 1.61s
```

Standard evidence used: `papers/itu-bs1770-5-loudness/notes.md`; page images enumerated under `papers/itu-bs1770-5-loudness/pngs/page-000.png` through `page-031.png`; inspected page images for printed pp. 3-7 and 18-21.

## Numbered Findings

1. HIGH - Worklet channel mapping violates LFE exclusion and can apply wrong weights to 5.1 input.
   - Code evidence: `src/processors/loudness-meter.ts:42` defines only `["L", "R", "C", "Ls", "Rs"]`; `src/processors/loudness-meter.ts:166` maps any later channel to `"C"`; weights are applied through this label at `src/processors/loudness-meter.ts:173`, `src/processors/loudness-meter.ts:181`, and `src/processors/loudness-meter.ts:249`.
   - Standard clause: BS.1770-5 Annex 1 Fig. 1 / printed p.3 excludes LFE from measurement; Annex 1 Table 3 / printed p.7 gives weights only for L, R, C, Ls, Rs, with Ls/Rs = 1.41. Notes mirror this at `papers/itu-bs1770-5-loudness/notes.md:82`.
   - Why this is a defect: the pure core has `LFE: 0` at `src/meters/loudness-core.ts:43`, but the live AudioWorklet path cannot label a channel as LFE. A six-channel signal is not reduced to the five measured channels; later channels are counted as `"C"`, and common 5.1 order would also mis-weight the surrounding channels.
   - Fix: add an explicit channel-layout path for the processor. For 5.1, map L/R/C/LFE/Ls/Rs and exclude LFE from momentary, short-term, and integrated sums. Add a processor test where a loud LFE channel does not change integrated loudness, momentary loudness, or short-term loudness.

2. MEDIUM - The true-peak "verbatim FIR" test is incomplete and would miss many wrong coefficients.
   - Test evidence: `src/meters/truepeak-core.test.ts:25` claims to expose the verbatim FIR, but `src/meters/truepeak-core.test.ts:26` through `src/meters/truepeak-core.test.ts:40` check phase count, tap count, two centre taps, and phase 0/3 symmetry only.
   - Standard clause: BS.1770-5 Annex 2 printed pp.18-19 gives a 48-tap, 4-phase FIR coefficient table. Notes transcribe all taps at `papers/itu-bs1770-5-loudness/notes.md:141`.
   - Current code result: I compared `src/meters/truepeak-core.ts:36` through `src/meters/truepeak-core.ts:57` against the page images and did not find a wrong 48 kHz FIR coefficient. The test still is not adequate evidence for that claim.
   - Fix: replace the partial assertions with full exact equality for all four 12-tap phases.

3. LOW - Non-48 kHz true-peak FIR generation is not backed by a conformance vector.
   - Code evidence: `src/meters/truepeak-core.ts:82` through `src/meters/truepeak-core.ts:87` raises the factor to meet at least 192 kHz, and `src/meters/truepeak-core.ts:98` through `src/meters/truepeak-core.ts:129` generates an N-phase Hann-windowed-sinc FIR when the factor is not 4.
   - Test evidence: `src/meters/truepeak-core.test.ts:126` through `src/meters/truepeak-core.test.ts:155` verify the factor and a -6 dB scaling property at 44.1 kHz, but not a standard vector or bounded under-read.
   - Standard clause: BS.1770-5 Annex 2 printed p.18 says the oversampled rate should reach at least 192 kHz; printed p.21 gives the under-read table and describes zero-stuffing plus low-pass interpolation.
   - Fix: add a bounded under-read/inter-sample fixture for 44.1 kHz, or document the generated FIR design target and assert its response against that target.

## Coefficient And Formula Checks

- K-weighting stage 1: PASS. `src/meters/loudness-core.ts:94` through `src/meters/loudness-core.ts:100` matches BS.1770-5 Annex 1 Table 1, printed p.4.
- K-weighting stage 2: PASS. `src/meters/loudness-core.ts:106` through `src/meters/loudness-core.ts:112` matches Annex 1 Table 2, printed p.5.
- Sample-rate handling for K-weighting: PASS against the "not naively reused" requirement. `src/meters/loudness-core.ts:164` through `src/meters/loudness-core.ts:227` re-derives coefficients for non-48 kHz rates; `src/meters/loudness-core.test.ts:123` through `src/meters/loudness-core.test.ts:130` covers 44.1 kHz 997 Hz calibration.
- Channel weights in the pure core: PASS. `src/meters/loudness-core.ts:43` through `src/meters/loudness-core.ts:50` implements L/R/C = 1.0, Ls/Rs = 1.41, LFE = 0. The worklet failure is finding 1.
- Loudness formula: PASS. `src/meters/loudness-core.ts:57` defines `-0.691`; `src/meters/loudness-core.ts:245` through `src/meters/loudness-core.ts:250` applies `-0.691 + 10 * log10(sum)`.
- Gating: PASS in the pure core. `src/meters/loudness-core.ts:343` through `src/meters/loudness-core.ts:365` creates 400 ms blocks with 75% overlap; `src/meters/loudness-core.ts:389` through `src/meters/loudness-core.ts:405` applies absolute -70 LKFS and relative -10 LU gates.
- True-peak 48 kHz FIR: PASS by manual page-image comparison. `src/meters/truepeak-core.ts:36` through `src/meters/truepeak-core.ts:57` matches the Annex 2 pp.18-19 coefficient table.
- True-peak can exceed sample peak: PASS. `src/meters/truepeak-core.test.ts:42` through `src/meters/truepeak-core.test.ts:56` asserts true peak greater than sample peak; `src/meters/truepeak-core.test.ts:58` through `src/meters/truepeak-core.test.ts:66` asserts an inter-sample overload above 0 dBTP.
- 997 Hz calibration: PASS. `src/meters/loudness-core.test.ts:36` through `src/meters/loudness-core.test.ts:46` asserts 0 dBFS 997 Hz on L/C/R reads -3.01 LKFS; the tolerance is `toBeCloseTo(..., 1)`, about 0.05 dB, not a +/-3 dB fudge.

## Liveness / Tail Check

- Liveness mechanism present: `src/cacophony.ts:1229` through `src/cacophony.ts:1231` creates a worklet node, creates a zero-gain sink, and passes that sink to `LoudnessMeter`; `src/meters/loudness-meter.ts:76` through `src/meters/loudness-meter.ts:80` connects worklet -> silent sink -> destination.
- Liveness test present: `src/meters/loudness-meter.test.ts:61` through `src/meters/loudness-meter.test.ts:77` proves the zero-gain sink graph wiring in the mock.
- True-peak finite-tail flush present: `src/meters/truepeak-core.ts:215` through `src/meters/truepeak-core.ts:221` and `src/meters/truepeak-core.ts:229` through `src/meters/truepeak-core.ts:240` process an 11-sample zero tail before returning one-shot true peak.
- Tail tests present: `src/meters/truepeak-core.test.ts:75` through `src/meters/truepeak-core.test.ts:80` and `src/meters/truepeak-core.test.ts:103` through `src/meters/truepeak-core.test.ts:109` cover final-sample peaks. The tolerance is -0.5 to +0.5 dBTP, which proves the tail is drained but does not prove exact FIR gain.
- Processor update path present: `src/processors/loudness-meter.ts:322` through `src/processors/loudness-meter.ts:339` posts reports; `src/processors/loudness-meter.test.ts:100` through `src/processors/loudness-meter.test.ts:118` drives render quanta and observes finite integrated loudness. I did not exercise a real browser AudioWorklet graph.

## Flags

- Vacuous/fudged-test flags: true-peak coefficient test is incomplete (`src/meters/truepeak-core.test.ts:25` through `src/meters/truepeak-core.test.ts:40`); true-peak inter-sample tests are relational rather than vector-based (`src/meters/truepeak-core.test.ts:42` through `src/meters/truepeak-core.test.ts:66`); processor tests do not cover LFE/channel layout.
- Wrong-coefficient flags: none found for the checked 48 kHz K-weighting or 48 kHz true-peak FIR constants. Non-48 kHz generated true-peak FIR needs stronger conformance evidence, but I did not mark it as a wrong coefficient because BS.1770-5 gives the printed coefficient set for the 4x case.
- Fake-citation flags: no fake provenance found. Minor imprecision: `src/processors/loudness-meter.ts:21` through `src/processors/loudness-meter.ts:22` says true peak is 4x polyphase oversampling, while the current detector can choose more than 4x at lower sample rates.

## Not Verified

- I did not run the full repo test suite.
- I did not run a live browser AudioWorklet graph; liveness evidence is code plus the existing mock/unit tests.
