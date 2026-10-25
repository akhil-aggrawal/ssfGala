# QA v2 · issue #87 · PR #90 · head 48cb38b

Round 2 changed only `test/super-board-local-db.test.ts` (child exit listener attached at spawn). CI `verify` is green on `48cb38b`.

| AC | Result | Proof |
|---|---|---|
| 1 Gate `db reset` runs in a scratch db | ✅ | config verify command run from the repo root: 13/13 migrations applied to `sb_scratch_*`, exit 0; main `schema_migrations` 13 before and after (`gate-canary.log`); test "gate reset applies every repo migration" passes |
| 2 Two lanes' pgTAP at once, own migrations | ✅ | parallel two-lane + gate test passes (`qa-tests.log`) |
| 3 Lock makes reset / e2e wait, then proceed | ✅ | lock wait, timeout exit 4 and `reset-main` after release tests pass |
| 4 Main rows unchanged | ✅ | canary row in main `public` identical before and after the gate command (`gate-canary.log`); canary test passes |
| 5 Cleanup on pass / fail / interrupt | ✅ | zero `sb_scratch_*` and no lock dir after the gate command; fail, SIGINT, TERM and stale-reap tests pass |

Commands
- `SB_LOCAL_DB_TESTS=1 npx vitest run test/super-board-local-db.test.ts` · 12 passed (`qa-tests.log`)
- `npm run verify` · 298 passed, 14 skipped (`npm-verify.log`)
- gate verify command around a canary row (`gate-canary.log`)

Test gaps (not written)
- Medium: `reset-main` still never ran a real reset of the main local database.
- Medium: the gate's verify loop not run end to end through `super-board-merge-gate.sh`.
- Low: SIGKILL of a `lock` holder on another host relies on `--stale-after` only.
