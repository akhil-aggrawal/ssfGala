# QA v1 · issue #87 · PR #90 · head 5e09a33

| AC | Result | Proof |
|---|---|---|
| 1 Gate `db reset` runs in a scratch db | ✅ | `test/super-board-local-db.test.ts` "gate reset applies every repo migration": config command records 13/13 migrations in `sb_scratch_*`; main `schema_migrations` count unchanged. Broken migration makes the scratch reset exit non-zero. |
| 2 Two lanes' pgTAP at once, own migrations | ✅ | builder test (two lane repos + gate reset in parallel). Real repo suite in a scratch db: 17 files, 236 tests PASS (`real-pgtap-scratch.log`). |
| 3 Lock makes reset / e2e wait, then proceed | ✅ | lock wait test; `reset-main` waits on a live holder and gives up with exit 4 without resetting; `reset-main` runs right after the e2e holder releases (fake `supabase` on PATH, so main was not reset). |
| 4 Main rows unchanged | ✅ | canary row survives gate reset + two lanes' pgTAP. |
| 5 Cleanup on pass / fail / interrupt | ✅ | lock released on fail + TERM; scratch dropped on fail + SIGINT; abandoned scratch db reaped past `--stale-after`; zero `sb_scratch_*` left after the run. |

Commands
- `SB_LOCAL_DB_TESTS=1 npx vitest run test/super-board-local-db.test.ts` · 12 passed (`qa-tests.log`)
- `npm run verify` · 298 passed, 14 skipped (`npm-verify.log`)

Test gaps (not written)
- Medium: `reset-main` never ran a real reset of the main local database (would wipe local data); only its lock path and exact CLI args are proven.
- Medium: the gate's verify loop was not run end to end through `super-board-merge-gate.sh`; the exact config command was run the same way (`sh -c` from the repo root).
- Low: SIGKILL of a `lock` holder on another host relies on `--stale-after` only.
