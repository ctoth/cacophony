2026-09-13: User approved retaining cross-origin caching, visible-header policy, browser validation, and precise documentation with TDD.
Existing branch already implements the agreed runtime behavior; added browser cases for exposed ETag validation and transition to no-store.
Red check against historical src/cache.ts from 5a01c41a: six Chromium CORS failures, two passes; current source restored byte-for-byte in finally.
No runtime change is needed unless green validation exposes a gap. Unrelated untracked notes remain untouched.
Next: document the browser-visible guarantee and versioned URLs, run green checks, commit scoped changes and update PR #234.
