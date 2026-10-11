# Deploy Docs workflow fix

## Findings

- Failed run: `30431311321`
- Failed job: `Deploy Docs / build-docs`
- Failed step: `Generate Documentation`
- The workflow ran Node 18 and `npm run docs` failed with `TS2307` because
  `node-web-audio-api` was not installed.
- `node-web-audio-api` requires Node 22 or newer.
- The same failure occurred on the two preceding master pushes, before PR 115,
  so it was not caused by the issue-98 source diff.

## Current state

- Branch: `agent/fix-docs-node-version`
- Commit: `af7bdad` (`Use Node 24 for docs deployment`)
- PR 116 merged as `20a690aaa5120cf4d080e28ead3d6c9a85c867b3`.
- The only committed change is `.github/workflows/docs.yml`, changing
  `node-version` from `18` to `24`.
- Local `npm run docs` passed under Node 22.18.0, which satisfies the dependency
  floor. It emitted existing TypeDoc warnings but no errors.
- All PR CI jobs passed before merge.
- Merge-triggered Deploy Docs run `30431868328` completed successfully at
  `https://github.com/ctoth/cacophony/actions/runs/30431868328`.
- Its `Install Dependencies`, `Generate Documentation`, and `Deploy` steps all
  passed.
- `notes-deep-review.md`, `notes-issue-98.md`, and this file remain untracked
  and must not be staged, committed, or pushed.

## Blocker

- No blocker.

## Next action

Follow-up action-version update:

- Branch: `agent/update-docs-actions`
- Commit: `d90f0df` (`Update docs workflow actions`)
- `actions/checkout` is pinned to the verified latest release `v7.0.1`.
- `actions/setup-node` is pinned to the verified latest release `v6.4.0`.
- The diff contains only those two requested `uses:` changes.
- PR 118 merged as `8b6958cc992b1f6e49be20df8ed906592c8176f1`.
- All PR CI jobs passed before merge.
- Merge-triggered Deploy Docs run `30432885216` completed successfully:
  `https://github.com/ctoth/cacophony/actions/runs/30432885216`.
- Checkout v7.0.1, setup-node v6.4.0, dependency installation, documentation
  generation, and deployment all passed.
- The final `build-docs` check reported `annotations_count: 0`; the deprecated
  action-runtime annotation is gone.
