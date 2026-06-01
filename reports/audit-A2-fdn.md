# Audit A2 FDN Reverb

VERDICT: DEVIATES

Workflow actually used: read `prompts/audit-A2-fdn.md`; read the named source, tests, and paper notes; enumerated `papers/**/pngs/page-*.png`; read the relevant paper page images for Schlecht eqs. 1, 7, 14 and Fagerstrom eqs. 1-12; ran the targeted FDN tests.

Verification performed:
- `npm test -- src/processors/fdn-reverb-core.test.ts src/fdn-reverb-effect.test.ts`
- Result: 2 files passed, 31 tests passed, duration 9.40s.

## Findings

1. Severity: HIGH - Fagerstrom VNS placement is input-only, but the implementation and comments present it as per-delay-line VFDN.

   Evidence: `src/processors/fdn-reverb-core.ts:49-56` says the core applies a distinct per-line VNS to the input injection, calls it the "single input-set placement", and says it does not compound to M^2. The constructor repeats this at `src/processors/fdn-reverb-core.ts:408-412`. The actual process loop confirms only the external input is VNS-filtered: `this.velvets[i].process(preDelayed)` is blended into `injected` and added to the feedback write at `src/processors/fdn-reverb-core.ts:522-530`. There is no output-branch VNS `c_i(z)` and no VNS inside the circulating delay-line/feedback signal.

   Paper authority: Fagerstrom notes define the VFDN transfer with `b(z)` and `c(z)` carrying VNS filters at `papers/fagerstrom-2020-velvet-noise-fdn/notes.md:86-91`. They distinguish single-side VNS as about `2M` at `papers/fagerstrom-2020-velvet-noise-fdn/notes.md:102-107` and both input/output VNS as `M^2` at `papers/fagerstrom-2020-velvet-noise-fdn/notes.md:109-114`. The page image `papers/fagerstrom-2020-velvet-noise-fdn/pngs/page-002.png` shows Fig. 4 with VNS filters on each input and output branch, then eq. 11 `E_single = 2M` and eq. 12 `E_both = M^2`.

   Eq violated: Fagerstrom 2020 Fig. 4 and eqs. 10-12, relative to the prompt's required per-line M^2 placement.

   Fix: implement the paper target with VNS on both the input and output branches for each delay line, then test the eq. 12 density increase. If the product decision is intentionally input-only, rename the feature and comments to `input-side b_i(z) VNS only`, remove "per-delay-line VFDN single" wording, and stop citing it as satisfying the M^2 VFDN placement.

2. Severity: MEDIUM - The "multiplication-free" VNS claim is not literally true in the filter implementation.

   Evidence: the comments say the VNS convolution is multiplication-free at `src/processors/fdn-reverb-core.ts:57-58` and `src/processors/fdn-reverb-core.ts:199-204`. The tap accumulation is add/subtract only at `src/processors/fdn-reverb-core.ts:238-242`, but the filter returns `acc * this.norm` at `src/processors/fdn-reverb-core.ts:244`, with `this.norm = 1 / Math.sqrt(taps.length)` set at `src/processors/fdn-reverb-core.ts:218-221`. The injection blend adds more per-line multiplies at `src/processors/fdn-reverb-core.ts:528-529`.

   Paper authority: Fagerstrom eq. 8 is the sparse signed-add convolution, recorded at `papers/fagerstrom-2020-velvet-noise-fdn/notes.md:77-82`, and the testable property says VNS convolution should require add/subtract operations and zero multiplications at `papers/fagerstrom-2020-velvet-noise-fdn/notes.md:214-217`.

   Eq violated: Fagerstrom 2020 eq. 8, for the strict "VNS FIR is add-only" claim.

   Fix: remove the per-sample normalization multiply from `VelvetFilter.process` or move the gain accounting outside the VNS FIR and stop calling the filter itself multiplication-free. Add a test that fails if the VNS filter applies a non-sign gain inside the convolution path.

3. Severity: MEDIUM - The VNS tests are misaligned with the paper-level fidelity claim.

   Evidence: `src/processors/fdn-reverb-core.test.ts:299-360` names Fagerstrom eqs. 11-12, but the tests only check nonzero tap counts, diffusion-on vs diffusion-off, and distinct RNG streams versus identical streams. They do not assert the presence of output-side VNS filters, do not compare input-only 2M against input+output M^2, and do not prove the code implements the Fig. 4/eq. 12 configuration. The "multiplication-free add structure" test at `src/processors/fdn-reverb-core.test.ts:229-233` only checks finite output.

   Eq violated: Fagerstrom 2020 eqs. 11-12 test obligation, not necessarily the executable code path.

   Fix: split tests by claim: one test for input-only eq. 11, one test for input+output eq. 12, and one structural test proving the output path actually applies `c_i(z)`. Replace the finite-output "multiplication-free" test with an assertion over the VNS implementation surface or a mechanical operation-count guard.

4. Severity: LOW - Losslessness is structurally supported, but the tests do not directly exercise absorption-disabled energy preservation.

   Evidence: the code builds a normalized Hadamard matrix at `src/processors/fdn-reverb-core.ts:127-146`, inserts pure feedback delays at `src/processors/fdn-reverb-core.ts:392-397`, and applies `D_kappa` before the Hadamard mix at `src/processors/fdn-reverb-core.ts:505-519`. That matches Schlecht DFM eq. 14: `A(z) = U D_m(z)`, verified in the paper image `papers/Schlecht_2019_ScatteringFeedbackDelayNetworks/pngs/page-002.png` and the notes at `papers/Schlecht_2019_ScatteringFeedbackDelayNetworks/notes.md:64-65`. The Hadamard orthonormality test at `src/processors/fdn-reverb-core.test.ts:67-78` is real.

   The gap is narrower: the "lossless/stable" DFM test renders with `decayTime: 2` at `src/processors/fdn-reverb-core.test.ts:285-295`, and the stability sweep uses finite T60 values at `src/processors/fdn-reverb-core.test.ts:184-206`. Those prove bounded decaying behavior, not absorption-disabled lossless energy preservation. Schlecht's losslessness condition is paraunitarity, `A~(z)A(z)=I`, at `papers/Schlecht_2019_ScatteringFeedbackDelayNetworks/notes.md:54-60`, with testable energy preservation at `papers/Schlecht_2019_ScatteringFeedbackDelayNetworks/notes.md:138-140`.

   Eq violated: none in the current implementation; test coverage is weaker than the lossless-core claim.

   Fix: add an explicit absorption-disabled harness, for example `decayTime: Infinity` and `damping: 0`, and assert bounded energy/no growth for the DFM core. Keep the current finite-T60 stability tests as separate decay tests.

## Faithful Evidence

- Standard FDN structure is present: N is constrained to 4 or 8 at `src/processors/fdn-reverb-core.ts:380-381`; delay-line reads, feedback matrix, input gain, output gain, and writes are implemented at `src/processors/fdn-reverb-core.ts:496-530`; wet/dry output is at `src/processors/fdn-reverb-core.ts:533-534`.
- Schlecht DFM scattering is real, not just a static Hadamard relabel: default nonzero feedback delays are declared at `src/processors/fdn-reverb-core.ts:107-114`, instantiated as `PureDelay`s at `src/processors/fdn-reverb-core.ts:392-397`, exposed by `feedbackDelays` at `src/processors/fdn-reverb-core.ts:430-433`, and tested against scalar zero-kappa at `src/processors/fdn-reverb-core.test.ts:261-282`.
- VNS taps are sparse plus/minus 1 taps: `buildVelvetNoise` computes grid spacing and M at `src/processors/fdn-reverb-core.ts:182-184`, jittered locations at `src/processors/fdn-reverb-core.ts:188-190`, signs at `src/processors/fdn-reverb-core.ts:191-193`, and tests plus/minus 1 and density at `src/processors/fdn-reverb-core.test.ts:86-122`.
- Public effect wiring is present: `FdnReverbEffect.build` loads `fdn-reverb` and passes options as `parameterData` at `src/effects.ts:284-293`; the effect tests cover factory, parameter forwarding, idempotent load, and bus routing at `src/fdn-reverb-effect.test.ts:21-118`.
