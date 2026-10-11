# Issue 168 checkpoint

- Finding: `Bus.addFilter` completed concurrent async effect builds in completion order and raw `AudioNode` validation surfaced as a rejected Promise; Bus and live playback also duplicated `EffectChain` guards with divergent messages.
- Implementation: commit `419e16a5` centralizes scoped duplicate, membership, permutation, and bypass guards in `EffectChain`; Bus uses `reserve`/`resolve`; live playback filter operations delegate chain validation; raw-node admission rejects synchronously.
- TDD red: focused `src/bus.test.ts` run failed the two new regressions (2 failed, 58 passed), including the unhandled rejection from raw-node validation.
- Local green: lint and typecheck clean; typed full suite 82 files / 1,131 tests; production build completed with the repository's existing TS4094 and TypeDoc warnings.
- GitHub state: PR #187 merged as `00c7254836db34acefefa9370133aa9145c7911e`; its body includes `Closes #168`, and issue #168 is closed.
- CI state: all six checks green: Lint & Format, Type Check, Test on Node 20/22/24, and Build.
- Final verification: local `master` and `origin/master` match the merge, PR head `419e16a5df1aed45b1fd8951b6b42701103106d3` is an ancestor, and only untracked `notes-*.md` files remain.
- Blocker: none; task complete.
- Next action: none.
