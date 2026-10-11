# Notes — issue #57 / streaming big-picture (2026-07-29)

Task: Q invoked /fix-github-issue 57, then rescoped mid-turn: think big-picture about streaming (#57, #59, what exists). Q approved the "ladder" plan and hls.js-as-optional-peer, then said "Superb. let's update/file!" — current phase is filing/updating issues, no code changes.

## VERIFIED this session (raw tool output seen)
- Read in full: src/cacophony.ts (1670 lines, 2 pages), src/sound.ts, src/stream.ts, src/stream-control.test.ts, notes-deep-review.md; README streaming sections via grep with context.
- `createStream()` → `createMediaSound(url, "streaming")` (cacophony.ts:1059-1061); `createSound(url,"streaming")` same (916-918). Grep of src for "streaming": nothing branches on it at runtime — identical to "html" path.
- src/stream.ts createStream: unexported, used only by its own test (grep), void return, WAV 44-byte header hack, per-network-chunk decode.
- Issue #59 (open, enhancement): Streaming contract, "Blocked by #57". Issue #58 (closed): synth pause — unrelated.
- hls.js: Apache-2.0, v1.6.16, ~24.8 MB unpacked (npm view output). cacophony: ISC, one hard dep (fft.js), optional peer pattern exists (standardized-audio-context, node-web-audio-api) — package.json grep.

## Plan approved by Q (in conversation)
Ladder: (1) honesty pass — streaming ≡ media element, README HLS fix, delete stream.ts; (2) PCM push source (worklet ring buffer class over RoutableSource); (3) WebCodecs pull adapter; plus optional hls.js adapter in media tier. #59 → rewritten as media-tier contract. #57 → rescoped as tracker for the ladder.

## State: DONE — all filed/updated (VERIFIED: each URL below is raw gh output this session)
- #129 honesty pass (bug)            https://github.com/ctoth/cacophony/issues/129
- #130 PCM push source (enh)         https://github.com/ctoth/cacophony/issues/130
- #131 WebCodecs pull adapter (enh)  https://github.com/ctoth/cacophony/issues/131
- #132 optional hls.js adapter (enh) https://github.com/ctoth/cacophony/issues/132
- #59 rewritten as media-tier contract + rescope comment (issues/59#issuecomment-5124452411)
- #57 rewritten as ladder tracker + rescope comment (issues/57#issuecomment-5124456135)
- Blocker: none. No code changes made; scratchpad drafts were the only files written besides these notes.
