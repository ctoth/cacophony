# Audit B3 - Time-Stretch vs Prusa 2022

## VERDICT

CONDITIONAL PASS on the deliberate directional frequency-propagation deviation: the current code honestly documents it as a measured deviation from Prusa 2022 Algorithm 1 lines 17/22, and I found no remaining comment that says the paper itself specifies directional forward-frequency propagation as Algorithm 1. The code preserves the main PGHI shape: both time and frequency phase gradients, magnitude-prioritized max-heap integration, no peak picking, no transient detection.

NOT A CLEAN PASS on PGHI guarantees. The first-frame special case can leave disconnected significant frequency regions unintegrated and zero-phased, bypassing the heap. The test suite has some real spectral/chirp/transient assertions, but it does not prove the PGHI benefit against a non-PGHI/classical-PV baseline and does not test the heap-order/first-frame disconnected-set guarantee.

Inputs read:
- Source: `src/processors/timestretch-core.ts`.
- Tests: `src/processors/timestretch-core.test.ts`.
- Paper notes: `papers/Prusa_2022_PhaseVocoderDoneRight/notes.md`.
- Paper page images: `papers/Prusa_2022_PhaseVocoderDoneRight/pngs/page-000.png` through `page-004.png`.
- Deviation justification: `reports/fix-B3-timestretch.md`.
- Commit messages: `ea118f9`, `d5dc059`.

## Numbered Findings

1. MAJOR - first-frame disconnected significant bins can bypass PGHI and keep zero phase.
   - File: `src/processors/timestretch-core.ts:385-425`.
   - Paper section/algorithm: Prusa 2022 Algorithm 1, lines 1-27, especially the max-heap propagation loop; notes mirror this at `papers/Prusa_2022_PhaseVocoderDoneRight/notes.md:169-189`.
   - Evidence: for `n === 0`, the implementation finds only one highest-magnitude significant seed (`src/processors/timestretch-core.ts:391-403`), then spreads only to adjacent significant bins (`src/processors/timestretch-core.ts:409-423`) and immediately `continue`s (`src/processors/timestretch-core.ts:425`). If the significant set has multiple frequency islands separated by insignificant bins, the later fallback for unreachable significant bins (`src/processors/timestretch-core.ts:478-489`) is skipped. Those unassigned significant bins remain at the `Float32Array` default phase 0.
   - Why this matters: PGHI's guarantee is not only "use a heap somewhere"; each significant bin should be assigned through the integration process, with propagation order decided by magnitude. The first-frame branch violates that for multi-component spectra.
   - Fix: make first-frame initialization cover every significant connected component. A conservative fix is to repeatedly seed the highest-magnitude remaining significant bin with its analysis phase, push it into the same max-heap, and frequency-propagate that component until no significant bins remain. Add a multi-tone test with separated significant islands.

2. MEDIUM - the "measured deviation" is documented, but not preserved as a reproducible gate.
   - File: `src/processors/timestretch-core.ts:275-297`; `reports/fix-B3-timestretch.md:37-61`.
   - Paper section/algorithm: Prusa 2022 Eq. 16-18 and Algorithm 1 lines 17/22; page image `page-002.png`; notes at `papers/Prusa_2022_PhaseVocoderDoneRight/notes.md:117-133` and `papers/Prusa_2022_PhaseVocoderDoneRight/notes.md:181-187`.
   - Evidence: the code says the forward/backward rectangle propagation is a "DELIBERATE, MEASURED deviation" (`src/processors/timestretch-core.ts:281-297`) and points to measured tonal/chirp/impulse numbers in `reports/fix-B3-timestretch.md:37-61`. I found no checked-in command, script, or regression test that directly compares the trapezoidal-centered variant against the kept directional variant.
   - Why this matters: the prose is honest, but the measurement can regress into lore. Current tests assert that the kept scheme has acceptable output properties; they do not prove that the rejected Algorithm 1 variant still fails the stated pitch/spectral-purity gate.
   - Fix: add a small checked-in comparison probe or regression test that exercises the known off-bin-tone case from the report and fails if the trapezoidal-centered alternative is reintroduced without meeting the same pitch/purity gate.

3. MEDIUM - tests demonstrate some coherence properties, but not the PGHI benefit or heap-order guarantee.
   - File: `src/processors/timestretch-core.test.ts:262-301`; missing direct heap/algorithm tests around `src/processors/timestretch-core.ts:93-159` and `src/processors/timestretch-core.ts:437-476`.
   - Paper section/algorithm: Prusa 2022 Algorithm 1 max-heap priority and adaptive time/frequency propagation; notes at `papers/Prusa_2022_PhaseVocoderDoneRight/notes.md:191-195` and testable heap invariant at `papers/Prusa_2022_PhaseVocoderDoneRight/notes.md:248`.
   - Evidence: `CHIRP coherence` asserts monotonic sweep, range, and bounded spectral spread (`src/processors/timestretch-core.test.ts:262-287`). `TRANSIENT coherence` asserts bounded temporal spread and burst amplitude (`src/processors/timestretch-core.test.ts:289-301`). Those are meaningful output checks, not pure length checks. But there is no baseline comparison showing that PGHI beats classical PV/no-frequency-propagation, no test that the max-heap pops globally highest magnitude first, and no test for the first-frame disconnected-island case in Finding 1.
   - Fix: add a focused heap-order/assignment invariant test through an exported test hook or narrow internal test seam, plus an output regression where a deliberately non-PGHI path would fail. Add the disconnected first-frame multi-tone case.

4. INFO - flat typed-array heap is real; one-frame look-ahead is algorithmic, not a streaming storage implementation.
   - File: `src/processors/timestretch-core.ts:93-159`, `src/processors/timestretch-core.ts:238-258`, `src/processors/timestretch-core.ts:306-326`.
   - Paper section/algorithm: Prusa 2022 RTPGHI one future frame for centered differences; notes at `papers/Prusa_2022_PhaseVocoderDoneRight/notes.md:197-200`.
   - Evidence: `MaxHeap` stores keys in `Float64Array` and payloads in `Int32Array` (`src/processors/timestretch-core.ts:100-108`) and implements binary-heap sift-up/sift-down (`src/processors/timestretch-core.ts:118-149`). The derivative calculation only needs previous/current/next phases (`src/processors/timestretch-core.ts:306-326`). However, this core precomputes and stores all frame magnitudes and phases (`src/processors/timestretch-core.ts:238-258`), so it is not a streaming RTPGHI buffer with only one frame of retained look-ahead. This is acceptable for the file's declared offline transform, but it is not proof of a real-time one-frame storage plan.
   - Fix: no code fix needed for the offline core. Do not describe this implementation as streaming one-frame-look-ahead unless storage is changed.

## Verified Against Paper

- PGHI ingredients present: time derivative, frequency derivative, magnitude-prioritized max-heap, no peak picking, no transient detection. Source evidence: `src/processors/timestretch-core.ts:260-337` computes gradients; `src/processors/timestretch-core.ts:339-476` integrates with heap; the file header explicitly rejects peak picking/tracking/transient detection at `src/processors/timestretch-core.ts:10-13`. Paper evidence: page image `page-000.png` introduction; notes at `papers/Prusa_2022_PhaseVocoderDoneRight/notes.md:13-24`.
- Phase derivatives: time derivative is centered in the interior (`src/processors/timestretch-core.ts:319-323`), frequency derivative is forward (`src/processors/timestretch-core.ts:332-335`). The code explicitly calls the frequency propagation a deliberate measured deviation from Algorithm 1 trapezoidal frequency propagation (`src/processors/timestretch-core.ts:275-297`).
- Heap priority: `push` and `pop` maintain a max-heap keyed by magnitude (`src/processors/timestretch-core.ts:118-149`). Previous-frame candidates are keyed by `sPrev[m]` (`src/processors/timestretch-core.ts:428-434`), and current-frame candidates are keyed by current magnitude (`src/processors/timestretch-core.ts:454`, `src/processors/timestretch-core.ts:467`, `src/processors/timestretch-core.ts:473`).
- OLA/framing: `factor` is stretch factor `alpha = a_s/a_a`; synthesis hop is `aS = round(aA * factor)` (`src/processors/timestretch-core.ts:205`), output length is `round(input.length * factor)` (`src/processors/timestretch-core.ts:497`), and validation rejects non-positive factor, invalid FFT sizes, fractional/nonfinite/out-of-range analysis hops (`src/processors/timestretch-core.ts:184-205`). Tests cover those validation cases at `src/processors/timestretch-core.test.ts:303-328`.

## Vacuous-Test Flags

- `unit: output length is exactly round(input.length * factor)` (`src/processors/timestretch-core.test.ts:203-213`) is length-only.
- `PITCH PRESERVED: a sinusoid keeps its dominant frequency after stretching` (`src/processors/timestretch-core.test.ts:215-226`) checks dominant bin only; it does not prove low phasiness/warble or heap integration.
- `rejects non-positive factor` (`src/processors/timestretch-core.test.ts:324-328`) is parameter validation only.
- `no NaN/Inf for a tonal input across factors` (`src/processors/timestretch-core.test.ts:330-335`) is finite-output only.
- `no NaN/Inf for a noisy input, and output stays bounded` (`src/processors/timestretch-core.test.ts:337-350`) is stability/bounds only.
- `silence in -> silence out` (`src/processors/timestretch-core.test.ts:352-357`) validates the zero-magnitude path only.
- `property: output length is monotonic non-decreasing in factor` (`src/processors/timestretch-core.test.ts:359-370`) is mostly length/finite/bounds.
- `deterministic: same input+factor+seed produces identical output` (`src/processors/timestretch-core.test.ts:372-378`) is determinism only.
- `timeStretchChannels stretches each channel independently` (`src/processors/timestretch-core.test.ts:380-391`) checks per-channel length/finite/dominant-bin behavior, not PGHI phase-coherence benefit.

Non-vacuous but incomplete:
- `SPECTRAL IDENTITY at factor=1` (`src/processors/timestretch-core.test.ts:228-260`) is a meaningful tonal purity/amplitude check.
- `CHIRP coherence` (`src/processors/timestretch-core.test.ts:262-287`) and `TRANSIENT coherence` (`src/processors/timestretch-core.test.ts:289-301`) are meaningful coherence-output checks, but they do not compare against classical PV/no-heap and do not prove the benefit comes from PGHI.

## Fake/Misattributed-Citation Flags

- No fake provenance found in the current source or tests for the directional frequency propagation. I searched the current code/test prose for `forward`, `directional`, and `Algorithm 1`, then checked the surrounding comments.
- The current comments distinguish the paper's forward/backward derivative formulas from the implementation's directional rectangle propagation. The clearest statement is `src/processors/timestretch-core.ts:280-297`: Algorithm 1 uses trapezoidal frequency integration; this code deliberately does not; the kept forward/backward directional schemes are described as gradient estimates from Eq. 16/17, not as Algorithm 1's propagation rule.
- The test header also states the distinction: paper Eq. 16/17 gradient schemes are propagated directionally rather than via Algorithm 1's trapezoidal step (`src/processors/timestretch-core.test.ts:7-12`).
- Commit-message context matches current code: `ea118f9` says false paper provenance was corrected, and `d5dc059` says a stale freq-update comment was fixed. I verified the commit messages, then verified the current comments.

## Answer To The Adversarial Questions

- Are tests vacuous? Some are. The length, finite-output, determinism, validation, and channel tests named above do not prove phase coherence. The spectral identity/chirp/transient tests are not vacuous, but they are not enough to prove the PGHI mechanism.
- Does any test demonstrate the PGHI phase-coherence benefit? No direct benefit test. Current tests demonstrate coherent-looking output properties for chirp/transient cases, but none compare against classical PV, no-frequency-gradient propagation, no heap, or wrong heap order.
- Is the deliberate deviation justified/measured or a euphemism? It is honestly documented as measured, with detailed numbers in `reports/fix-B3-timestretch.md:37-61`, and the code comments do not dress it up as Algorithm 1. I did not rerun the historical measurement, and I found no automated gate that preserves the comparison.
- Are in-code citations specific and honest? Yes on the directional-deviation point. The code cites Eq. 16/17 for forward/backward derivative estimates and explicitly says Algorithm 1 lines 17/22 are trapezoidal and deliberately not used.
