You are worker: cacophony decoded audio cache memory bounds.

Parallel swarm warning: other agents may be editing unrelated leak families. Do not modify files outside the owned paths below. No oneliners.

Task:
Fix decoded AudioBuffer cache memory growth in Cacophony.

Owned paths:
- src/cache.ts
- direct tests for cache behavior

Evidence to gather:
- Current decodedBuffers LRU policy and how size is calculated.
- Current stores of decoded AudioBuffer values.
- Existing cache test conventions.

Required outcome:
- Decoded AudioBuffer memory cache is bounded by estimated bytes, not merely item count.
- Eviction releases old decoded buffers under sustained many-large-sound workloads.
- Existing clearMemoryCache semantics still clear decoded cache and pending requests.
- Add or update focused tests when practical.

Report:
- Files changed.
- Exact tests or type checks run.
- Any browser-only behavior not verified.
