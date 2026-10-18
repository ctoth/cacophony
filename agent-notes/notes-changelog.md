# CHANGELOG work (2026-09-26)

## State
- Six background agents are backfilling history into scratchpad/changelog/part1..6.md (brief: scratchpad/changelog/BRIEF.md).
- Tooling written (uncommitted): scripts/changelog.mjs (+ test, 8 passing), package.json preversion/version/changelog:check + CHANGELOG.md in "files",
  release.yml extracts notes -> body_path, new .github/workflows/changelog.yml PR check (skip-changelog label).
- Facts: 171 tags, 134 GH releases all with empty bodies; many tags never published to npm (listed in BRIEF). No v0.22/v0.27 tags.

## Progress
- part6 (0.30-0.33) done. Breaking: 0.30.0 applyFilters/removeFilters removed; 0.31.0 createStereoToBFormatNode(options, signal);
  0.32.0 play() option validation, HTTP-policy AudioCache, stopped playbacks reaped. Parts 1-5 still running.
- CLAUDE.md got a "Changelog and releases" section. Preamble draft at scratchpad/changelog/preamble.md.
- release.yml backslash continuation was mangled by the heredoc; fixed with Edit.

- All 6 parts done; assembled into CHANGELOG.md (1575 lines, 170 versions = all v* tags), `check` passes.
- Added uniform "First npm release after X (unpublished)" pointer to 18 published versions following gaps (scratchpad gaps.cjs).
- Gotcha: backslashes in Bash heredocs get collapsed by the tool; write scripts with Write instead.
- To reconcile: fades removed 0.9.0 vs "introduced" 0.18.0; drop unverified-bug claims.

- Read the full CHANGELOG. Fixes applied: 0.23.0 mic wording; 0.18.0 fades "last available in 0.8.7" (verified via git grep);
  0.5.22 isPlaying/stop regression -> fixed in 0.6.2 (verified at v0.6.1 vs v0.6.2); 0.5.23 moved Fixed->Changed, fixed in 0.6.1.

- DONE: PR #240 (branch chore/changelog, skip-changelog label). User ran backfill: edited=134 created=36 failed=0; v0.33.0 still Latest.

## Next
- Assemble parts into CHANGELOG.md (preamble + Unreleased + parts newest-first), `check --fix`, spot-verify claims.
- Docs: CONTRIBUTING/CLAUDE.md release section. Ask user before editing GH release bodies (outward-facing).
