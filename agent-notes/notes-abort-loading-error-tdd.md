Checkpoint: abort loading-error review fix
- Added three regression cases and observed all fail before the implementation change.
- Cancellation now reports one abort error directly to its subscriber; observer exceptions remain isolated.
- All 1,207 tests, typecheck, scoped Biome checks, and diff checks passed.
- Committed only src/cache.ts and src/cache.policy.test.ts as 288f4800; no blocker.
- Next: push fix/229-http-cache-policy and verify the remote commit; leave this note uncommitted.
