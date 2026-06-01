# Audit B2 FOA -> Binaural Decoder vs Ahrens 2022

## VERDICT

NEEDS FIXES before B2 can be called complete.

The current decoder graph is no longer the old stereo hack: it routes W, Y, Z,
and X into both ears and applies the Y right-ear sign inversion. That matches
the practical Eq. 31 multiply-accumulate shape for a real SH basis:

`B(omega) = sum_n sum_m S_n,m(omega) H_n,m(omega)`

Evidence: Ahrens Eq. 23 is the per-ear binaural rendering equation over SH
coefficients (`papers/.../notes.md:61-65`; page image `page-004.png`), and
Eq. 31 removes the degree flip under a real basis (`papers/.../notes.md:67-71`;
page image `page-005.png`). The implementation wires every FOA channel into
both ears (`src/effects.ts:497-509`) after slicing the 4-row HRIR into WY and
ZX stereo convolver buffers (`src/effects.ts:473-480`).

But the tests still do not prove the resurrected path produces ear-differentiated
audio, and the SN3D/HRIR convention is asserted rather than locally tested.

## Numbered Findings

1. [HIGH] Resurrection tests are graph-only and do not prove binaural output.

- Evidence: The requested resurrection check is a 2-channel, ear-differentiated
  signal with `L != R` for an off-center source and near symmetry for a center
  source. The existing resurrection tests only assert `upmixer.connect(decoder.input)`
  and a 4-channel input splitter (`src/foaDecoder.test.ts:321-341`), then assert
  that the binaural merger feeds the output node (`src/foaDecoder.test.ts:344-353`).
- Vacuity: No test renders samples, reads left/right channel data, asserts
  lateralized `L != R`, or asserts center `L ~= R`.
- Eq: Ahrens Eq. 31, per-ear SH MAC. A graph edge into `decoder.input` is not
  evidence that Eq. 31 produces the expected L/R audio.
- Fix: Add a deterministic audio-level test. Use `encodeMonoToFoaSN3D` for
  center/front and left/off-center cases, feed a controlled SH-HRIR or equivalent
  deterministic convolver fixture, then assert center is approximately symmetric
  and left/off-center differs by ear in the expected direction.

2. [HIGH] The SN3D end-to-end convention is not proven by current tests or asset metadata.

- Evidence: The encoder explicitly emits SN3D/ACN `[W,Y,Z,X]` (`src/spatial/foa-encode.ts:1-17`)
  and implements `W=s`, `Y=s*cos(phi)*sin(theta)`, `Z=s*sin(phi)`,
  `X=s*cos(phi)*cos(theta)` (`src/spatial/foa-encode.ts:37-47`). Tests cover
  front, left, up, W invariance, 180-degree horizontal mirroring, and linearity
  (`src/foaDecoder.test.ts:90-158`).
- Decoder side: the code claims the decoder, Omnitone HRIR, and encoder are
  all SN3D with no `sqrt(3)` rescale (`src/effects.ts:420-424`) and loads a
  4-channel HRIR (`src/cacophony.ts:613-634`). The NOTICE only proves a
  4-channel, 48 kHz, 16-bit, 256-sample Omnitone asset and provenance
  (`src/assets/NOTICE:4-15`); it does not state SN3D normalization or row signs.
- Paper convention risk: Ahrens Table 1 is explicitly about five convention
  combinations, and rows 4/5 are the N3D-standard rows that yield the simple
  `B = sum S_n,m H_n,m` form (`papers/.../notes.md:117-119`; page image
  `page-007.png`). The local decision report says cacophony deliberately uses
  SN3D/ACN and relies on the Omnitone HRIR being SN3D-matched
  (`reports/scout-b2-decode-decision.md:181-189`), but that is not exercised
  by `src/foaDecoder.test.ts`.
- Eq: Ahrens Eq. 31 and Table 1. A normalization mismatch between encoder and
  HRTF rows silently scales Y/Z/X by `sqrt(3)` relative to W.
- Fix: Add a convention test that fails under an inserted `sqrt(3)` N3D/SN3D
  mismatch. Also add an auditable HRIR convention record beside the asset, or a
  small verifier that checks the bundled file against the expected Omnitone
  channel order and normalization assumptions.

3. [MEDIUM] The audit prompt's "8 convolvers per plan" does not match the checked-in B2 plan or implementation.

- Evidence: The audit prompt asked to verify "8 convolvers per plan: 4 channels x 2 ears."
  The checked-in locked B2 plan instead says the chosen topology is Omnitone's
  2-stereo-`ConvolverNode` packing, "NOT 8" (`reports/scout-b2-decode-decision.md:20-22`,
  `reports/scout-b2-decode-decision.md:28-33`). The implementation follows that:
  two convolvers are created (`src/effects.ts:473-480`) and the test asserts
  `convolvers.length === 2` (`src/foaDecoder.test.ts:172-185`).
- Eq: Ahrens Eq. 31 requires per-ear summation over SH channels. It does not
  require eight Web Audio node objects. The current source implements an
  Omnitone-packed equivalent graph, not the literal 8-node topology.
- Fix: Resolve the control-surface mismatch. Keep the 2-stereo-convolver graph
  only with an explicit plan/report statement that this satisfies the SH-domain
  MAC. Require the audio-level tests from finding 1 so the packed graph is not
  trusted solely by connect-spy structure.

4. [MEDIUM] The old per-ear channel-drop bug is covered structurally, not numerically.

- Evidence: The implementation connects W/Y/Z/X to left and W/-Y/Z/X to right
  (`src/effects.ts:497-509`). The regression test asserts those exact edges
  (`src/foaDecoder.test.ts:222-247`), including the Y inverter path
  (`src/foaDecoder.test.ts:244-246`).
- Remaining gap: The test stubs node factories and verifies `connect` calls.
  It does not prove convolver buffer slicing, channel interpretation, summing,
  or ear outputs under actual audio processing.
- Eq: Ahrens Eq. 31, per-ear weighted multiply-accumulate over all FOA channels.
- Fix: Keep the graph test, but add one render-level or pure-DSP oracle test
  that feeds isolated W, Y, Z, and X impulses and proves each contributes to
  both ears with the expected Y sign.

## Convention-Mismatch Flags

- ACN channel ordering: PASS for the positional encoder and decoder wiring.
  Encoder returns `[W,Y,Z,X]` (`src/spatial/foa-encode.ts:35-47`); decoder input
  maps ch0/ch1 to WY and ch2/ch3 to ZX (`src/effects.ts:460-471`).
- SN3D vs N3D: FLAGGED UNPROVEN. Encoder tests prove SN3D-style unit first-order
  gains (`src/foaDecoder.test.ts:99-105`), but the HRIR asset metadata does not
  state SN3D (`src/assets/NOTICE:4-15`) and no test detects a `sqrt(3)` mismatch.
- Condon-Shortley / 180-degree azimuth trap: PARTIAL PASS. The encoder has a
  180-degree mirroring property test (`src/foaDecoder.test.ts:127-149`). There
  is no decoder-level directional audio test.
- Propagation vs incidence: FLAGGED UNPROVEN IN TESTS. Ahrens Eq. 24/25 says
  incidence/propagation confusion inserts a `(-1)^n` factor
  (`papers/.../notes.md:79-89`). The implementation relies on the bundled
  Omnitone HRIR already being decode-ready; no local test exercises the sign.
- Fourier sign: FLAGGED UNPROVEN IN TESTS. The implementation uses the bundled
  HRIR as a time-domain FIR bank and applies no explicit `i^n` or `i^-n` factor.
  That is acceptable only if the HRIR was precomputed under the matched convention.

## Vacuous-Test Flags

- `src/foaDecoder.test.ts:321-341`: proves the upmixer node connects to
  `decoder.input`; does not prove audible resurrection, L/R difference, or
  center symmetry.
- `src/foaDecoder.test.ts:344-353`: proves the output endpoint is fed by the
  binaural merger; does not prove that output has correct channel samples.
- `src/foaDecoder.test.ts:172-185`: proves two ConvolverNode objects exist,
  while the audit prompt asked for an 8-convolver check. The test matches the
  in-repo Omnitone-packing plan, not the prompt's literal 8-node statement.

## Fake-Citation Flags

- No fake Ahrens citation found. The code cites Ahrens Eq. 31 for the real-basis
  per-ear MAC (`src/effects.ts:380-386`), which matches the paper notes and page
  images (`papers/.../notes.md:61-71`; `page-004.png`, `page-005.png`).
- No synthetic HRIR passed off as measured. The shipped asset is disclosed as
  Omnitone `sh_hrir_order_1.wav`, Apache-2.0, with source path and commit
  (`src/assets/NOTICE:4-15`). Tests use a stub HRIR (`src/foaDecoder.test.ts:64`)
  but do not pass that stub off as real binaural evidence.
- Provenance weakness: the code says the Omnitone graph is mirrored "VERBATIM"
  (`src/effects.ts:399-400`, `src/effects.ts:484-486`). The in-repo decision
  report records web confirmation (`reports/scout-b2-decode-decision.md:12-14`,
  `reports/scout-b2-decode-decision.md:41-47`), but the source comment itself
  does not cite the Omnitone file path or commit. Add that exact file/commit
  citation near the topology comment.
