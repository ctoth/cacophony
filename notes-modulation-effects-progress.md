# Modulation Effects — Foreman Progress / State

Goal: add a paper-faithful modulated-delay effect family on branch
`feat/modulation-effects`, foreman-driven (coder + verifier), TDD, then Codex
signoff against the paper PNGs. Clean, beautiful, PR-worthy.

## Where we are (state machine)

- [x] Branch `feat/modulation-effects` created.
- [x] Papers retrieved + read (paper-retriever/paper-reader subagents):
      - `papers/Dattorro_1997_EffectDesignPart2ChorusModulation/` (PNGs + notes) — topology Fig.36, Tables 6/7.
      - `papers/Laakso_1996_SplittingUnitDelayFIR/` (PNGs + notes) — Lagrange Eq.42, N=1/3 table, M_opt Eq.21.
      - NOTE: `papers/` is git-ignored; artifacts live on disk only (correct — binaries not committed; Codex reads PNGs from disk).
- [x] Codebase grokked → `notes/arch-survey-modulation.md` (7-file worklet-effect pattern, rollup auto-globs, gates).
- [x] Plan written → `notes/modulation-effects-plan.md` (one Dattorro Fig.36 core → delay/chorus/flanger/vibrato/doubling; cubic-Lagrange interp default + linear; Table 6 presets; param table).
- [x] Coder implemented full 9-file family TDD; first pass all 4 gates green (822 tests, +34).
- [x] Verifier (NO-MERGE) found 1 real BLOCKER (2 coupled findings):
      1. `modulated-delay-core.ts readFractional` inverted tap direction → realized delay off by +2·frac samples (linear AND cubic).
      2. Acoustic/core fractional tests were VACUOUS (passed for either direction) — repo's signature "structure proven, invariant not" failure mode.
      Verifier confirmed CORRECT: Lagrange coeffs themselves, topology/feedback fixed-center-tap, energy-bounded feedback, buffer safety, param plumbing, Table 6 preset fidelity, the 2 biome-ignores, style/fit.
- [~] IN FLIGHT (background): coder applying surgical fix TDD —
      flip taps (linear: `intDelay`/`intDelay+1`; cubic: `{intDelay-1,intDelay,intDelay+1,intDelay+2}` for D=1+frac),
      raise lower read clamp 1→2, add NON-VACUOUS oracle test (ramp/sine at 10.25/20.5/30.75-sample delay, `toBeCloseTo(ideal,6)`) that is RED on old code / GREEN after fix.
      Coder agentId: acdb95ca68c24e528.
- [ ] Re-verify fix (gates green + new test fails-then-passes).
- [ ] Codex paper-compliance audit: prompt STAGED at `prompts/codex-modulated-delay-review.md`;
      run `codex exec --dangerously-bypass-approvals-and-sandbox "Read prompts/codex-modulated-delay-review.md and write report to reports/codex-modulated-delay-report.md"`;
      iterate on findings until clean + genuinely paper-compliant (Q's explicit instruction).
- [ ] Commit clean on branch (foreman commits, not the coder). PR-worthy.

## Key decisions (paper-grounded)
- Interpolation = Lagrange FIR (cubic default, linear option), NOT allpass — Laakso p.52 (no coeff transients under modulation) + p.42 (|H|≤1 feedback-safe). Allpass deferred (Dattorro ±1-semitone limit), documented.
- Topology = Dattorro Fig.36 verbatim; feedback from FIXED center tap, never modulated tap (p.775).
- Presets = Dattorro Table 6 verbatim knobs; delay ranges within Table 7.
- LFO sinusoidal (p.767), bipolar; per-channel quadrature `ch·π/2` (p.776).
- Scope EXCLUDES phaser (allpass cascade — diff paper) and tremolo (amplitude) — clean future follow-ups.

## Verification recipe for this repo (from memory)
Run gates + read raw output myself, AND use codex as independent oracle reading the paper PNGs.
codex runs sandbox-bypass and may stage files in shared git index → commit with explicit pathspec, `-m` BEFORE `--`.

## Round 2 — verifier fix verified, Codex audit done
- [x] Coder fixed inverted tap direction (newest→oldest taps, clamp 1→2); RED-on-old (off 2·frac) / GREEN-on-new oracle added. I re-ran gates myself: build:worklets 0, 824 tests, typecheck 0, lint 0.
- [x] Codex paper-compliance audit (`reports/codex-modulated-delay-report.md`): FAIL (3 findings). I verified each against the Dattorro PNGs (page-011/012) MYSELF:
      - BLOCKER: feedback SIGN. Code wrote `x + fb` (denominator 1−fb·z^−c, positive fb). Fig.36 summer has "−" on feedback; p.775 "negative feedback path"; p.776 TF `1 + feedback·z^−center`. Must be `x − fb`. Breaks white-chorus allpass property if wrong. CONFIRMED via figure.
      - should-fix: near-zero clamp (readDelay<2→2) blocks Dattorro's "sweep to absolute zero" (p.775, Table7 onset 0). Fix: clamp→0, cubic falls back to linear when intDelay<1.
      - should-fix: "white chorus" naming — Dattorro = neg feedback + ALLPASS interp; we use cubic Lagrange. Add honest caveat (don't rename).
      - Codex PASSED: Lagrange coeffs, tap addressing/M_opt, LFO sin+quadrature, interpolation choice (defensible).
- [~] IN FLIGHT (background, coder acdb95ca68c24e528): apply `x − fb` + sign-sensitive echo test ((−0.5)^k, RED-on-old) + white-chorus allpass |H|≈1 test + near-zero clamp/linear-fallback + white-chorus doc caveat.

## Round 3 — all Codex findings fixed, Codex re-audit PASS
- [x] Coder fixed all 3 Codex findings + a 4th structural corollary (dry/blend tap reads recirculation node w[n], not raw x, so H(z) matches Fig.36 printed form). Feedback summer subtracts (`w = x − fb`). Through-zero clamp→0 + cubic→linear at head. Honest white-chorus caveat. +5 tests (sign-echo (−0.5)^k RED-on-old; white-chorus |H|≈1; through-zero ×3). 829 tests.
- [x] I re-ran gates myself: build:worklets 0, 829 tests, typecheck 0, lint 0.
- [x] Codex RE-AUDIT (`reports/codex-modulated-delay-reaudit-report.md`): **PASS, no remaining findings.** Independently confirmed against Fig.36/Tables6-7/Laakso: feedback sign, dry-tap-off-w[n] node (Fig.36 labels post-summer node "x[n]"; blend branches there), through-zero bounds, non-vacuous tests, all 5 presets verbatim Table 6.
- [~] IN FLIGHT (background, verifier a37df0c16e09449c6): final MERGE gate on corrected tree (re-run gates + confirm non-vacuous + OOB-safe + presets). Flips earlier NO-MERGE.

## DONE — committed on branch
- [x] Verifier final gate: **MERGE** (re-derived H(z) by hand, proved oracle tests RED-on-old side-by-side, confirmed buffer bound exactly tight, presets verbatim, no regression).
- [x] Restored incidental dynamics/phase-vocoder/timestretch bundle rebuilds (`git checkout --`); staged only the 12 modulated-delay files.
- [x] Committed `a1f84b8` on feat/modulation-effects: "Add modulated-delay effect family (chorus/flanger/vibrato/delay/doubling)", 12 files, 2112 insertions. Pre-commit biome hook passed.
- notes/, prompts/, reports/ are gitignored (no scaffolding in the commit). notes-modulation-effects-progress.md (this file) left untracked = foreman scratch, not committed.

## Final state
Goal complete: papers pulled+read (paper-retriever/paper-reader subagents) → planned → foreman-driven coder+verifier TDD → 2 review rounds (verifier caught inverted taps; Codex caught feedback sign + dry-node + through-zero) → Codex re-audit PASS → verifier MERGE → committed on branch. 829 tests green, typecheck/lint/build clean. Paper-faithful to Dattorro 1997 Fig.36/Tables6-7 + Laakso 1996 Eq.42.

## Next (NOT done — needs Q's go-ahead, outward-facing)
- push branch / open PR — only on Q's explicit ask.
- optional: CHANGELOG entry; phaser (allpass cascade) + tremolo as future follow-ups (deliberately out of scope, noted in plan).

## Blockers
None. Modulated-delay family committed (a1f84b8). Now adding phaser + tremolo, same procedure.

---

# PHASE 2 — Phaser + Tremolo (same procedure, same branch)

Q approved adding phaser + tremolo "same procedure" (papers→plan→foreman coder+verifier TDD→Codex→commit).

## Papers pulled (paper-agent2, PNGs on disk, gitignored)
- PHASER (strong anchor): `papers/Smith_1984_AllpassPhasingFlanging/` — J.O. Smith STAN-M-21 + PASP §8.9. pages/page-*.png (9) + fig_img*.png (6) + notes.md.
  - 2nd-order allpass section H(z)=(α+βz⁻¹+z⁻²)/(1+βz⁻¹+αz⁻²), α=R², β=−2R cosθ; θ=2πfT (notch tune), R=e^(−πBT) (notch width, R<1 stable).
  - 1st-order VA alt (PASP §8.9): (a+z⁻¹)/(1+a z⁻¹), break-freq map p_d=(1−tan(ω_bT/2))/(1+tan(ω_bT/2)).
  - Notch wherever cascade phase hits odd×180°; N sections→N notches (order-12 ex=6 notches); classic MXR=4 1st-order=2 notches. Log/multiplicative LFO sweep (preserves notch ratios), ex 100–800Hz, rate ~0.1–10Hz. Feed-around gain g sets notch depth/direction (g<0 inverts). Overall gain bounded [0,2] given stable sections — inherently safe.
- TREMOLO (WEAK backing, honest): `papers/Mitcheltree_2023_ModulationExtractionLFO/` — DAFx23 LFO-extraction (ML); only backs LFO/VCA framing + shape/rate conventions. No dedicated VA tremolo paper freely available.
  - AM law y=x·g, g=(1−depth)+depth·shape(lfo) (keep g≥0; negative=ring-mod). Real bias/optical tremolo = smoothed slightly-asymmetric sine. Sidebands f_c±f_m amp m/2. Quadrature auto-pan (90° L/R) ← Dattorro 1997 p.776 (already cited). Zipper: per-sample smooth gain.

## Decision pending (planning): tremolo paper-backing is thin.
Anchor tremolo to: AM math + LFO/quadrature-oscillator design (Dattorro 1997 quadrature LFO already in collection + DAFx23 for LFO conventions). Be honest in JSDoc that it's elementary AM, not a dedicated-paper DSP core. Codex will check the AM/quadrature math + (phaser) allpass-coeff/notch math against PNGs.

## Phase 2 — implemented, dual gates running
- [x] Plan: `notes/phaser-tremolo-plan.md`.
- [x] Coder (acdb95ca68c24e528) implemented phaser + tremolo TDD, sequential. 18 files (9 each), wiring in effects.ts/cacophony.ts/index.ts, factories createPhaser/createTremolo/createAutoPan. +53 tests → 879 total.
      - Phaser: N identical 1st-order allpass (MXR-style), `breakFreqToAllpassCoeff` = verbatim PASP p_d, but processor uses `a = −p_d` so notch tracks fb UPWARD (coder verified analytically+FFT); additive `y=x+mix·v`; feedback regen; quadrature stereo.
      - Tremolo: AM `g=(1−depth)+depth·0.5·(1+lfo)`, g≥0; sine/triangle/square enum; live stereoPhase via channelIndex offset (Dattorro p.776 quadrature); honest JSDoc (no dedicated-paper claim).
- [x] I re-ran gates myself: build:worklets 0, 879 tests, typecheck 0, lint 0.
- [~] RUNNING (background): verifier2 (afd72032a1ff49497) adversarial merge-gate; Codex (b25d1mo5d) paper audit → reports/codex-phaser-tremolo-report.md. Codex prompt: prompts/codex-phaser-tremolo-review.md. Both focus the phaser sign/notch-at-fb + additive-sum, and tremolo sidebands/anti-phase/honest-attribution non-vacuously.

## Codex focus flagged by coder
Phaser `a = −p_d`: breakFreqToAllpassCoeff returns verbatim PASP Eq.8.20 p_d; recurrence `(a+z⁻¹)/(1+a·z⁻¹)` with a=−p_d notches AT fb (a=+p_d would notch at Nyquist complement). Load-bearing sign detail.

## Verifier2 (afd72032a1ff49497): MERGE
Independently re-derived: phaser a=−p_d → notch at 1002Hz for fb=1000 (a=+p_d would be 22998Hz Nyquist complement) ✓ load-bearing sign correct; additive |H(DC)|=2 (crossfade would be flat ≤1, tests non-vacuous); notch count = stages/2 exactly; feedback clamped ±0.95 finite; tremolo g∈[1−depth,1] never negative, sidebands 0.167@depth0.5 (dry none), anti-phase corr<−0.9 @stereoPhase180, real no-zipper bound; honest JSDoc no over-claim; param names consistent, ranges match plan, factories correct, style matches. 879 tests, all gates exit 0. No blockers/should-fix; 2 nits (don't block).

## Codex (b25d1mo5d): STILL RUNNING
reports/codex-phaser-tremolo-report.md (not yet written). It's the named paper-compliance signoff — MUST wait for PASS before commit. Focus: phaser sign/notch-at-fb + sweep framing vs Smith PNGs; tremolo AM/quadrature/honest-attribution.

## Next step
Await Codex. If PASS → commit phaser+tremolo files on branch (restore incidental dynamics/phase-vocoder/timestretch/modulated-delay bundle rebuild churn; keep only phaser-bundle.js+.map, phaser-core-bundle.js+.map, tremolo-bundle.js+.map, tremolo-core-bundle.js+.map). Then update memory + final summary. If Codex FAIL → iterate via coder acdb95ca68c24e528.

## Blockers
None for effects. Phaser+tremolo committed eaa8446 (verifier MERGE + Codex PASS).

---

# PHASE 3 — Playground update (Q: "update the playground for the effects")

Playground = single accessible `index.html` (Vite dev, `npm run dev`), one numbered
<section> per feature, effects use shared `makeEffectAB` (bus-routed dry/wet A/B).

## Done (edits to index.html)
- Verified factory + option names against committed API (effects.ts/cacophony.ts):
  createChorus/Flanger/Vibrato/Doubling/Delay (ModulatedDelayOptions: delayTime,depth,rate,feedback,blend,feedforward,interpolation — NO mix),
  createPhaser (PhaserOptions: frequency,rate,depth(oct),stages,feedback,mix),
  createTremolo/createAutoPan (TremoloOptions: rate,depth,shape 0/1/2,stereoPhase deg).
- Added 3 new sections grouped after Dynamics(8): §9 Modulated delay (preset dropdown
  chorus/flanger/vibrato/doubling/delay + rate/depth/feedback sliders; preset-change
  syncs sliders to natural values, only overrides rate/depth/feedback so factory keeps
  blend/feedforward character), §10 Phaser (freq/rate/depth/stages/feedback/mix), §11
  Tremolo/auto-pan (shape + stereo-mode dropdowns + rate/depth).
- Renumbered existing sections 9→12..13→16 (headings + matching JS comments) so effects
  stay grouped.
- Each new section mirrors the existing accessible pattern (labels, aria-describedby
  readouts, role=status announcements via say(), makeEffectAB dry/wet+stop).

## Verification (non-visual proof — IN PROGRESS / NEXT)
Q is blind: must give non-visual proof, NOT ask him to look.
1. node --check the extracted inline module script (syntax valid).
2. Cross-check every getElementById("x") has a matching id="x" in the HTML (no dangling wiring).
3. Factory/option names already grep-verified against committed src.
(No automated e2e for index.html in repo; the inline script isn't covered by vitest/build.)

## Next step
Run the two verification checks. If clean → commit index.html on branch (scoped, single
file). If id-mismatch/syntax error → fix. Then final summary. Note for tremolo auto-pan:
audibility of L/R offset depends on loop.wav being stereo (documented in the section text).
