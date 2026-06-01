# Audit B1 Pitch-Shift vs Laroche-Dolson 1999

## VERDICT

PASS on the DSP provenance for the core implementation: the production code has real peak picking, half-way region-of-influence assignment, rigid region translation, and one cumulative complex rotator per peak applied to every bin in that peak's region. I found no production per-bin atan2/unwrap phase-propagation path in `src/processors/phase-vocoder-core.ts` or `src/processors/phase-vocoder.ts`.

FAIL on the resurrection proof: the user-facing Playback/Sound tests prove factory call, graph insertion, and `pitchFactor` AudioParam forwarding through a fake node, but they do not prove that an actual Playback-path signal exits with its fundamental moved to `pitchFactor * f0`.

Evidence read: `prompts/audit-B1-pitch.md`; `src/processors/phase-vocoder-core.ts`; `src/processors/phase-vocoder.ts`; `src/processors/phase-vocoder-core.test.ts`; `src/pitch-shift-resurrection.test.ts`; `src/processors/phase-vocoder-multichannel.test.ts`; `src/playback.ts`; `src/sound.ts`; `src/cacophony.ts`; `papers/laroche-dolson-1999-improved-phase-vocoder/notes.md`; paper page images `page-001.png`, `page-002.png`, `page-003.png`.

Targeted verification run:

```text
npm test -- src/processors/phase-vocoder-core.test.ts src/pitch-shift-resurrection.test.ts src/processors/phase-vocoder-multichannel.test.ts
Result: 3 files passed, 23 tests passed.
```

## Numbered Findings

1. **MAJOR - Resurrection claim is not signal-proven**
   - Section: pitchFactor wiring / "previously-dead code now carries signal".
   - Evidence: `src/pitch-shift-resurrection.test.ts:31-45` builds a fake phase-vocoder node with spy-only `connect`, `disconnect`, and `parameters.get`; `src/pitch-shift-resurrection.test.ts:61-74` proves `createPhaseVocoderNode` was called; `src/pitch-shift-resurrection.test.ts:77-94` proves panner -> fake node -> gain node wiring; `src/pitch-shift-resurrection.test.ts:97-112` proves param forwarding. None of these tests run the real `PhaseVocoderProcessor` through the Playback graph or inspect audio output.
   - Why it matters: the audit prompt asks whether `pitchFactor` changes pitch and whether a test proves the previously-dead code now carries signal. The current tests prove control-plane resurrection, not data-plane pitch shifting.
   - Fix: add an offline or worklet-shell integration test that feeds a sine at `f0` through the actual pitch-shift path with a non-unity factor and asserts the output spectral peak is near `pitchFactor * f0`. Keep the existing fake-node graph tests as wiring coverage.

## Verified Mechanism Against Paper

- Peak detection exists and matches the paper's simple two-neighbor peak rule. Paper notes: Section 3.2 at `papers/laroche-dolson-1999-improved-phase-vocoder/notes.md:36-39`. Code: `src/processors/phase-vocoder-core.ts:49-67`. Test: `src/processors/phase-vocoder-core.test.ts:58-71`.
- Region-of-influence assignment exists and uses half-way boundaries between adjacent peaks. Paper notes: Section 3.2 at `papers/laroche-dolson-1999-improved-phase-vocoder/notes.md:36-39`. Code: `src/processors/phase-vocoder-core.ts:166-186`. Test: `src/processors/phase-vocoder-core.test.ts:74-96`.
- Rigid region translation exists. Code computes `peakIndexShifted = Math.round(peakIndex * pitchFactor)`, iterates offsets from the source peak, and writes to the corresponding shifted bins at `src/processors/phase-vocoder-core.ts:218-273`.
- Single per-peak complex rotation exists. Paper notes: Section 3.5 at `papers/laroche-dolson-1999-improved-phase-vocoder/notes.md:48-52` and equations at `papers/laroche-dolson-1999-improved-phase-vocoder/notes.md:68-78`. Code computes one `frameRotation` at `src/processors/phase-vocoder-core.ts:90-93`, accumulates one rotator per peak at `src/processors/phase-vocoder-core.ts:128-145`, fetches one rotator per peak at `src/processors/phase-vocoder-core.ts:224-229`, and applies that same `rot` to every bin in the region at `src/processors/phase-vocoder-core.ts:231-272`.
- No production arctangent/unwrap phase propagation found. Literal search for `atan2|unwrap|previousPhase|phaseAccumulator|expectedPhase|lastPhase|phaseBuffer` in `src/processors/phase-vocoder-core.ts` and `src/processors/phase-vocoder.ts` returned only the comment at `src/processors/phase-vocoder-core.ts:27`. The `Math.atan2` calls are test-only phase inspections at `src/processors/phase-vocoder-core.test.ts:53-55`, `src/processors/phase-vocoder-core.test.ts:153`, `src/processors/phase-vocoder-core.test.ts:351`, and `src/processors/phase-vocoder-core.test.ts:381`.
- Per-channel cumulative phase state is independent. Code stores `rotators: PeakRotatorState[][]` at `src/processors/phase-vocoder.ts:34-40`, lazily allocates `inputRotators[j]` per channel at `src/processors/phase-vocoder.ts:96-104`, advances only that channel's state at `src/processors/phase-vocoder.ts:113-128`, and the multichannel regression tests drive the real `processOLA()` path at `src/processors/phase-vocoder-multichannel.test.ts:89-162`.
- Playback wiring exists. `refreshFilters()` splices `_pitchShiftNode` between the filter tail and gain node at `src/playback.ts:658-675`; `setPitchShift()` builds the node via `cacophony.createPhaseVocoderNode` at `src/playback.ts:720-727`; it forwards the AudioParam at `src/playback.ts:730-733`; `Sound.setPitchShift()` stores and fans out the factor at `src/sound.ts:550-560`; future playbacks inherit it at `src/sound.ts:259-267`.

## Vacuous-Test Flags

- `src/pitch-shift-resurrection.test.ts:61-216`: not vacuous for graph/control-plane wiring, but vacuous for acoustic pitch-shift proof. Every pitch node in this file is fake (`src/pitch-shift-resurrection.test.ts:31-45`), so the tests cannot prove the worklet carries signal or moves a fundamental.
- `src/processors/phase-vocoder-multichannel.test.ts:121-125` and `src/processors/phase-vocoder-multichannel.test.ts:160-161`: the `energy > 0` assertions are only nonzero guards. The meaningful assertions are the stereo-vs-stereo equality and stereo-vs-mono equality at `src/processors/phase-vocoder-multichannel.test.ts:114-119` and `src/processors/phase-vocoder-multichannel.test.ts:154-157`.
- `src/processors/phase-vocoder-core.test.ts:127-195` and `src/processors/phase-vocoder-core.test.ts:197-244`: these are not vacuous for the paper mechanism; they verify same-rotator and intra-region phase-delta invariants. They still do not replace an end-to-end "sine f0 -> output peak near pitchFactor*f0" test through Playback.

## Fake-Citation / Fake-Provenance Flags

- No fake Laroche-Dolson provenance found in the core implementation. The cited mechanisms are present: peak detection, region-of-influence translation, one rotator per peak, no production atan2/unwrap.
- The remaining provenance risk is in the resurrection tests' prose, not the core citation: `src/pitch-shift-resurrection.test.ts:7-18` says the tests are proof the worklet "now lives", but the file proves only fake-node graph insertion and param forwarding. It does not prove real audio signal flow through the worklet.

