## Checkpoint: issue #242 grooming, 2026-09-30
- Finding: #238 owns attachment identities; replacement invalidates replaced bindings at commit, while single-slot replacement preserves neighboring nodes/bindings.
- State: #242 title/body updated and published text verified against the draft; current code and React Client's mute/rebuild and master-overlay ownership inspected.
- Contract: build before commit, bounded output/tail fade, latest uncommitted request wins, committed fades finish, and retirement follows audio-context time; no implementation changes.
- Blocker: none. Next action: implementation follows #238's Bus attachment/lifecycle foundation; this checkpoint remains uncommitted.
