Task: groom GitHub issue #238 (shared parameter definitions + stable effect-slot references) against the current architecture at 0986e1b3; no implementation requested.
Verified so far: 17 registerProcessor calls and 13 processors with parameterDescriptors match the issue's inventory claim; the 62-entry count is not yet verified.
Read effects.ts, effectChain.ts, routableSource.ts, basePlayback.ts, worklets.ts, cli/effects-registry.ts; EffectChain identifies entries by AudioNode handle and reservation symbol only, no slot names.
Observed: source recipes are a plain CacophonyEffect[] with per-playback materialization and build failures only console.warn'd in RoutableSource._preparePlayback.
Next: read related issues #45/#198/#200/#207 (persisted output bemriws1q.txt), bus.ts, sound.ts, group.ts, volumeMixin, cacophony.ts factories, processor descriptors; then write findings and a proposed issue edit. Publishing to GitHub not yet authorized.

Checkpoint 2: verified inventory (17 processors, 13 with descriptors, 62 params: barberpole 4, dattorro 12, dynamics 6, fdn 5, freqShifter 2, harmonizer 5, modDelay 7, phaseVocoder 1, phaser 6, spectralFreeze 3, stereoWidener 3, tremolo 4, waveshaper 4); all k-rate.
Findings: enum tables duplicated (effects.ts *_TO_INDEX vs processors *_BY_INDEX); unknown alias silently maps to 0; dattorro preDelay max is sampleRate-1 (not context-free); cacophony.ts already imports processors/*-core modules, so a global-free shared-definitions module has precedent; rollup bundles each processor file with its imports inlined.
Findings: EffectChain identity is node handle + reservation symbol, no slot names; Bus.addFilter drops the CacophonyEffect object after build (no type identity retained); RoutableSource rejects same recipe twice; Sound.clone/Playback.clone drop non-biquad effect recipes; _preparePlayback swallows build failures with console.warn; Playback.play is sync and starts before async effect builds; rampParam warns/no-ops on unresolved params (documented Bus contract) and resolves by name at call time.
Related: #214 closed; #198 variation has no effect-parameter field, so acceptance 6 "initial variation" has no consumer; #200 uses filterIndex and bus output.gain (owner-level param, not a slot); #207 envelopeGain separate (consistent); ImpulseResponseEffect dry/wet is the existing exposed multi-node graph param.
Next: write findings + redraft to scratchpad, run adversary review, report; publishing to GitHub #238 awaits user authorization.

Checkpoint 3: findings.md, draft.md, original.md, title.txt written to scratchpad 238/ (C:/Users/Q/AppData/Local/Temp/claude/C--Users-Q-code-cacophony/8293581b-2e40-4e4a-ad5c-acdd2dd4e427/scratchpad/238/).
Adversary review of draft.md is running in the background; draft is not published. Next: fold review findings into draft, report to user, await authorization to edit #238.

Checkpoint 4: adversary review returned 0 blocking, 6 should-fix, 5 nits; all folded into scratchpad 238/draft.md (shared-recipe carve-out, degraded-voice + recoverable error event, structured resolver failures for #200, all RoutableSource subclasses and SynthGroup, generated legacy filter slot names, per-processor tree-shakeable definitions, bundle-check export budget, anonymous buses).
State: draft complete and unpublished. Blocker: user authorization to edit GitHub #238.

Published draft to #238 on 2026-09-15; read-back matches draft except a trailing newline. Task complete.
