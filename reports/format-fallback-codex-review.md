# Codex review: format-fallback

## Verdict
CHANGES_REQUESTED

## Summary
The implementation covers the main happy path for URL-array fallback and keeps the MIME map in the shape the brief requested. The README update is scoped, the changed paths are limited to `src/cacophony.ts`, `src/cacophony.test.ts`, and `README.md`, and the required array-selection tests are mostly present.

I would not land this as-is. The fallback loop treats every non-abort `cache.getAudioBuffer` rejection as if it were a decode failure, but the brief explicitly allows fallback only after decode failure, not fetch failure. The refactor also changes an existing single-URL behavior by hardcoding loaded URL sounds as `buffer` after the helper returns.

## Findings
1. MAJOR - behavior contract - fetch/cache failures incorrectly fall through to later formats. In `createSoundFromUrlArray`, every non-`AbortError` thrown by `loadBufferSound` is caught, recorded as a decode error, and the loop continues to the next playable URL (`src/cacophony.ts:546`). `loadBufferSound` wraps the whole `cache.getAudioBuffer` operation, not just decode (`src/cacophony.ts:510`), and `getAudioBuffer` can reject for fetch/cache errors before or around decode. The brief says decode failure falls back, "NOT fetch fails"; this implementation will hide a failed fetch of the selected playable source and fetch another candidate instead of propagating the fetch failure.

2. MAJOR - refactor risk - the single-string URL path no longer preserves the caller's existing `soundType` for non-HTML/non-streaming values. The old path constructed `new Sound(..., soundType, ...)` after cache load; the new path calls `loadBufferSound` for any single URL that is not `html` or `streaming` (`src/cacophony.ts:507`), and `loadBufferSound` always constructs `new Sound(..., "buffer", ...)` (`src/cacophony.ts:520`). Because `SoundType` includes `"oscillator"`, `createSound("x.mp3", "oscillator")` changes from returning a `Sound` tagged as `oscillator` to one tagged as `buffer`, violating the brief's "single-string URL behavior unchanged" requirement.

3. MINOR - error reporting - mixed unsupported/decode-failed arrays do not give a reason for every URL. When playable candidates all fail, the final error lists all URLs in `Tried [...]` but only includes detailed reasons for entries in `decodeErrors` (`src/cacophony.ts:556`). Unsupported URLs filtered out at `src/cacophony.ts:538` have no per-URL "codec unsupported" reason in that final all-failed error, despite the brief requiring all-unplayable errors to list URLs and reasons.

4. MINOR - test coverage - the tests do not cover the fetch-failure/no-fallback contract or the refactor regression above. The new fallback tests cover first playable, unsupported first, decode fallback, no playable, empty array, and HTML/streaming rejection (`src/cacophony.test.ts:827`), but there is no case where the first playable URL fails to fetch and must reject without trying the second, and no regression asserting single-URL `soundType` preservation for the existing non-HTML/non-streaming path.

## If CHANGES_REQUESTED
1. Split fallback handling so only decode failures advance to the next playable URL. Fetch/cache/other load failures should reject immediately, while aborts should continue to reject immediately as they do now.

2. Preserve the previous single-string URL behavior by passing the original `soundType` through the buffer-load helper, or otherwise keep the old construction semantics for non-array URLs.

3. Include a reason for every candidate in the final URL-array failure message, including unsupported-extension/unsupported-codec candidates that were filtered before decode attempts.

4. Add focused regression tests for fetch failure not falling back and for the single-URL refactor behavior that currently changed.

## Recommendation
merge after fixes
