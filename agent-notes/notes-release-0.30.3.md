# npm release 0.30.3

## Findings and observations

- The initial `v0.30.2` tag release run `31837617593` failed during `npm run ci:test` because `src/cli/render-core.test.ts` imports `dist/node.mjs`, but `.github/workflows/release.yml` ran tests before the build created `dist`.
- The main CI workflow already encoded the correct clean-checkout contract by building before tests on supported Node versions.
- Commit `b2ee81e8` reorders the release job to build before testing.
- Commit `c117cd2e` bumps `package.json` and `package-lock.json` to `0.30.3`.
- A fresh linked checkout ran `npm ci`, `npm run build`, and `npm run ci:test`; 82 test files and 1,138 tests passed with no type errors. The build retained existing TS4094 and 35 TypeDoc warnings.
- Exact-head CI run `31837965731` and docs run `31837966768` succeeded for `c117cd2e1e593bf43120e8d6c043fa84910289bb` before tagging.
- Tag release run `31838147428` succeeded through build, tests, GitHub release creation, and npm publication.
- The npm registry reports `cacophony@0.30.3`, `latest` is `0.30.3`, and provenance attestations are present.
- Remote `master` and `refs/tags/v0.30.3` both resolve to `c117cd2e1e593bf43120e8d6c043fa84910289bb`.
- Existing untracked `notes-*.md` files were not staged or modified as part of the release.

## Current state

- `v0.30.2` remains unchanged and has no successful npm publication.
- `v0.30.3` is the successful GitHub and npm release.
- No release blocker remains.

## Next action

- Report the successful release, workflow URLs, npm version/provenance, exact SHA, and preserved untracked notes to the user.
