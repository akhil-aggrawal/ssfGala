# QA #76 v1 · PR #77 @ 36f2504

Non-visual change (merge gate script), so no screenshots.

| AC | Test (`test/super-board-merge-gate-restamp.test.ts`) | Result |
|---|---|---|
| 1 reused version renamed after base | renames a migration that reuses a merged version | pass |
| 2 older version renamed after newest | renames a migration that sorts before the newest merged one | pass |
| 3 two gates together, unique increasing | merges two migration PRs gated together | pass |
| 4 other head moves exit 6 | plain commit, rename+SQL edit, plus QA: evil merge, non-base merge, non-migration rename, retitled rename, base-migration rename, force-push | pass (8 cases) |
| 5 no migration, no extra commit | merges a PR that adds no migration | pass |

Mutation check: `check()` forced to accept everything makes all 6 QA cases fail.

Full suite: `npm run verify` 200 passed, 1 skipped.

## Test gaps (not written)
- Medium: a human-gated PR (exit 7) whose migration needs a re-stamp gets its approval voided by the gate's own push (approval is head-bound), so the human approves twice.
- Medium: ssfgala `verify_commands` does not run `supabase db reset`, so a rename that reorders dependent SQL is not caught at merge (already in the PR risk).
- Low: `newest + 1` can produce a non-clock version (e.g. `...235960`); Supabase only needs digits, so it still sorts and applies.
