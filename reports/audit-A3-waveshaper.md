# VERDICT

PASS on the DSP implementation against Parker 2016 first-order ADAA. I found the eq.9 quotient, the eq.10 midpoint fallback, and both requested F0 antiderivatives implemented correctly in the requested source files.

TEST GAP on antialiasing fidelity. The tests are not vacuous overall, but the suite does not include a spectral comparison proving ADAA reduces aliasing versus naive `f(x)` on a high-drive sweep.

## Evidence Read

- Source: `src/processors/waveshaper-core.ts`, `src/processors/waveshaper.ts`, `src/effects.ts`.
- Tests: `src/processors/waveshaper-core.test.ts`, `src/waveshaper-effect.test.ts`.
- Paper notes: `papers/parker-2016-adaa-waveshaping/notes.md`.
- Paper page images inspected directly: `papers/parker-2016-adaa-waveshaping/pngs/page-001.png` for eq.9, `page-002.png` for eq.10, `page-003.png` for eqs.19-25.

## Numbered Findings

1. `src/processors/waveshaper-core.test.ts:185` / `src/processors/waveshaper-core.test.ts:201` - Severity: Medium - Eq: Parker 2016 eq.9, with antialiasing effectiveness shown by the paper's sweep results rather than by these tests. Fix: add a deterministic spectral regression that compares naive hardclip/tanh `f(x)` against the ADAA processor on a high-drive sine sweep or chirp and asserts reduced folded alias energy, preferably against a high-rate reference or a fixed alias-band mask.

   The bounded-output tests prove finite range only: hardclip output stays within `+/-1` and tanh output stays within `(-1, 1)`. A direct naive waveshaper would also satisfy those properties. The suite does have stronger equation-level tests at `src/processors/waveshaper-core.test.ts:64` and `src/processors/waveshaper-core.test.ts:90`, so this is not a total vacuity finding; it is a missing antialiasing-fidelity gate.

## Paper Equation Checks

- Eq.9: Parker page image `page-001.png` shows `y[n] = (F0(x_n) - F0(x_{n-1})) / (x_n - x_{n-1})`, with `F0` the antiderivative of `f`. The implementation computes `denom = xn - this.xPrev` at `src/processors/waveshaper-core.ts:163` and, outside the singularity branch, computes `shaped = (f0n - this.f0Prev) / denom` at `src/processors/waveshaper-core.ts:172`. The direct helper also returns `(f0(xn) - f0(xPrev)) / denom` at `src/processors/waveshaper-core.ts:203`.
- Eq.10: Parker page image `page-002.png` shows the midpoint fallback `f((x_n + x_{n-1}) / 2) + O((x_n - x_{n-1})^2)`. The implementation uses an epsilon guard, not exact equality: `ADAA_EPS = 1e-5` at `src/processors/waveshaper-core.ts:66`, `Math.abs(denom) < ADAA_EPS` at `src/processors/waveshaper-core.ts:165`, and `f((xn + this.xPrev) / 2)` at `src/processors/waveshaper-core.ts:168`. The helper mirrors this at `src/processors/waveshaper-core.ts:200` and `src/processors/waveshaper-core.ts:201`.
- Tanh F0: Parker eq.20 on `page-003.png` gives `F0(x) = log(cosh(x))`. The implementation's stable form at `src/processors/waveshaper-core.ts:84` through `src/processors/waveshaper-core.ts:87` is mathematically equivalent: `|x| + log((1 + exp(-2|x|)) / 2)`.
- Hardclip F0: Parker eq.25 on `page-003.png` gives `F0(x) = x^2/2` for `-1 <= x <= 1`, otherwise `x sgn(x) - 1/2`. The implementation uses `0.5 * x * x` for `abs(x) <= 1` and `abs(x) - 0.5` otherwise at `src/processors/waveshaper-core.ts:108` through `src/processors/waveshaper-core.ts:112`. Both branches equal `0.5` at `x = +/-1`, so continuity is preserved.
- No aliasing-defeating shortcut found in the requested implementation path. `Math.tanh` appears only inside `fTanh` at `src/processors/waveshaper-core.ts:71` through `src/processors/waveshaper-core.ts:73`; the per-sample processor uses the F0 quotient except for the eq.10 midpoint fallback.

## Vacuous-Test Flags

- Flag: `src/processors/waveshaper-core.test.ts:185` through `src/processors/waveshaper-core.test.ts:199` checks hardclip range/finite output. This would not distinguish ADAA from naive hard clipping.
- Flag: `src/processors/waveshaper-core.test.ts:201` through `src/processors/waveshaper-core.test.ts:216` checks tanh range/finite output. This would not distinguish ADAA from naive tanh.
- Not flagged as vacuous: `src/processors/waveshaper-core.test.ts:64` through `src/processors/waveshaper-core.test.ts:87` compares `adaaSample` to the eq.9 F0 quotient.
- Not flagged as vacuous: `src/processors/waveshaper-core.test.ts:90` through `src/processors/waveshaper-core.test.ts:116` tests the eq.10 singularity/midpoint path, including a near-equal `ADAA_EPS / 10` case.
- Not flagged as vacuous: `src/processors/waveshaper-core.test.ts:17` through `src/processors/waveshaper-core.test.ts:42` checks tanh F0 against `log(cosh)` and hardclip F0 at the origin, knees, and outside branches.

## Fake-Citation Flags

- None found in the requested source files. `src/processors/waveshaper-core.ts:5` through `src/processors/waveshaper-core.ts:28` cite Parker, Zavalishin & Le Bivic 2016 and identify eq.9/eq.10 accurately.
- None found in the worklet shell. `src/processors/waveshaper.ts:10` through `src/processors/waveshaper.ts:14` honestly points to the core for eq.9, eq.10, F0 antiderivatives, and 0.5-sample group delay.
- None found in the effect class. `src/effects.ts:302` through `src/effects.ts:306` describes first-order ADAA eq.9, midpoint fallback eq.10, and group delay eq.17 accurately.
- Additional waveshaper public factory comments in `src/cacophony.ts:1144` through `src/cacophony.ts:1165` also match the implementation: `shape: 0` hardclip, `shape: 1` tanh, and `createDistortion` defaults to `{ drive: 4, shape: 1 }`.
