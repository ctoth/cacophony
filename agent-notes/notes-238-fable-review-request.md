# Cacophony issue 238: technical design review

Review the proposed GitHub issue text in notes-238-proposed-revision-20260918.md against this TypeScript audio library's source. It was drafted by OpenAI Codex and needs an independent Claude technical review before publication. Do not edit files, implement code, or publish anything. Return a concise report of concrete findings and recommended contract changes, with file/line references. Do not delegate.

Focus on correctness and achievable scope: references and attachment lifetimes; named snapshot addresses; asynchronous preparation and failure cleanup; preserving existing playback behavior; metadata defaults/units/domains; integration boundaries with automation. Is deferring pitch-shift and clone integration sound? What should be simplified?

Start with the proposal and these files: src/routableSource.ts, src/basePlayback.ts, src/effectChain.ts, src/effects.ts (interfaces, wrappers and ImpulseResponseEffect), src/sound.ts (preplay, play, clone, cleanup), src/playback.ts (play, setPitchShift, clone). Read specific relevant ranges of other source files only as needed. Existing issue snapshots are at C:/Users/Q/AppData/Local/Temp/cacophony-238-fable-20260918/issue-238-original.json and issue-45.json, issue-198.json, issue-200.json, issue-207.json.

One additional integration concern: Sound.play installs a listener that removes the pending play listener on any error (src/sound.ts around 410). Does adding recoverable effect errors require distinguishing them so eventual media playback success still propagates?

Return verdict READY or REVISE, material findings with exact recommended decisions, and any tradeoffs. We need a review report, not an implementation plan or a transcript of your deliberations.
