# Issue 142

## Findings

- GitHub issue #142 is open and remains reproducible on current `origin/master`.
- `Cacophony` constructs `master` as a normal `Bus`, so `master.destroy()` tears down its internal and destination routes.
- The existing `expectReachable` graph helper can assert the master bus's observable `input -> output` route.
- Ordinary named and anonymous buses must remain destroyable.

## TDD evidence

- Red: `npm test -- src/bus-integration.test.ts` failed because `cacophony.master.destroy()` did not throw.
- Green: the same command passed all 18 tests after adding a constructor-level `destroyable` flag, setting it to `false` only for master, and throwing `The master bus cannot be destroyed`.
- `npm run lint` passed.

## State

- Branch: `agent/protect-master-bus`
- Commit: `83937d5 Protect master bus from destruction`
- PR: #147, merged at `2026-07-30T07:54:37Z`, with `Closes #142`
- Merge commit: `4eb6e825059f7f32ae8b1ded97857801427696b5`
- Tracked changes: `src/bus.ts`, `src/cacophony.ts`, `src/bus-integration.test.ts`
- Local gates: lint, typed full suite, and build passed.
- Live CI: Lint & Format, Type Check, Test (20), Test (22), Test (24), and Build passed.
- Issue #142 closed automatically as completed at `2026-07-30T07:54:38Z`.
- Blocker: none.

## Next action

None. The requested TDD implementation, PR, green CI gate, merge, and issue closure are complete.
