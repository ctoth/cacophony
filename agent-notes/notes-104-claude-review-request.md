# Independent review of Cacophony #104

The author is OpenAI Codex. You are the independent Claude reviewer. Read-only review: do not modify files, commit, publish, or merge. Return the full review as your response. First line must name your tool and actual model.

Review worktree C:/Users/Q/code/cacophony-issue-104 at commit ce0986ab7832a37c465e53976c8ba17748bc22fe against origin/master (base 6a6acda0). Inspect the actual diff and relevant callers/tests, not only this description. Read src/AGENTS.md and CLAUDE.md.

Issue #104: assigning stereoPan on an HRTF source silently stores unusable defaults when no voices exist, or stores defaults and throws mid-fanout when voices exist. It must reject immediately without state change. Stereo sources retain valid behavior. Check symmetric HRTF-controls-on-stereo cases.

Approved implementation contract:
- Spatial writes validate source mode and every targeted voice before changing any defaults or voice; mixed modes reject the entire broadcast in either order.
- Shared PlaybackContainer owns Sound/Synth/stream broadcast checks; direct playback setters and play(options) share spatial validation.
- position and threeDOptions follow the same rule. threeDOptions configures HRTF and never implicitly switches mode; ThreeDOptions now describes HRTF only.
- Group and SynthGroup preflight their spatial broadcasts; clone mode changes remain explicit and work.
- Preserve smoothing behavior, partial options, input ownership and current/future voice consistency.

Files changed: src/container.ts, src/pannerMixin.ts, src/playOptions.ts, src/mediaStream.ts, src/pcmStream.ts, src/group.ts, src/synthGroup.ts, src/synth.ts, src/spatial-controls.test.ts, scripts/check-published-types.mjs, README.md, CHANGELOG.md.

Validation already obtained: 105 Vitest suites/1442 tests passed; 41 issue regressions include native HRTF-node and stereo-rendering proof. Build/typecheck/package-types/bundle checks, Biome and changelog passed. Browser matrix: 62 passed, 26 Windows platform skips, five Firefox browserContext.close internal protocol errors; all five passed in one isolated retry with one worker. Final fixture adjustment reran all 41 regressions successfully.

Review correctness and the stated principles. Find concrete bugs, bypasses, unintended breaks, missing tests, or unnecessarily complex design. Check runtime preflight against actual backend setter constraints, mixed modes, cleaned voices, stream reuse, partial/default snapshots, clone behavior, and type/package contracts. Distinguish required fixes from optional suggestions. For each finding give severity, file/line, reproducible scenario, consequence, and smallest principled correction. Do not invent findings to meet a quota. End with APPROVE or REQUEST CHANGES and explain remaining blockers.
