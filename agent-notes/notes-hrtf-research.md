# HRTF research checkpoints

## 2026-10-01 — Research requested
- Normal point-source HRTF uses Web Audio PannerNode; a separate Omnitone-based FOA decoder accepts compatible SH-HRIR overrides.
- Existing source sends originate after spatialization; independently directed reflections would need an earlier signal branch.
- User requested research with the research-papers plugin before implementation; no audio source changes are authorized by this research request.
- Applying the plugin research skill to produce an implementation-focused literature report; full paper-reader ingestion is a separate workflow.
- Next: survey current primary papers and implementations, verify mathematical claims, and record evidence limits and browser feasibility.

## 2026-10-01 — Literature survey assembled
- Located 2023 magnitude-corrected time alignment, 2024 NIIRF, 2025 masked MagLS/RANF, and February/September 2026 HRTF upsampling preprints.
- Verified that NIIRF and newer magnitude-only upsampling need separate ITD handling; masked MagLS evidence is model-based on one dummy-head dataset.
- Found September 2026 LAP24 perceptual data, stimuli, and public audio examples; recorded these as reproducible follow-up resources without claiming an audition.
- Room-detail and near-field listening studies temper the initial advice: gains depend on stimulus, dataset, and the quality of diffuse reverberation.
- Next: write the cited research report, preserving source/evidence distinctions and current Cacophony graph constraints; no implementation or benchmarks performed.

## 2026-10-01 — Report completed
- Created reports/research-hrtf-sota-2026-10-01.md with DSP equations, primary citations, implementation licenses, evidence limits, and project-specific recommendations.
- Chrome responded after the user's update; read published RANF and LAP24 evaluation sections and checked the perceptual-study repository.
- Added RANF+ and small challenge-evaluation scope; distinguished objective challenge ranking from unreviewed human perceptual rankings.
- Recommended a measured direct-source candidate plus shared spatial room field, gated by controlled comparisons and real browser measurements.
- No audio implementation, package installation, model run, listening audition, commit, or push performed; report and checkpoints remain uncommitted.
