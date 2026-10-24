# Issue #6 QA v1: row-level security

Head under test: `d1ebd31` plus the QA test commit.

| AC | Test | Result |
|---|---|---|
| AC1 sponsor cannot select another sponsor's attendees | `row_level_security_test.sql` 3-4, edges 1-4 | pass |
| AC2 anon / authenticated insert into `payments`, `user_roles` fails | `row_level_security_test.sql` 8-12, edges 14-16 | pass |
| AC3 admin selects every attendee of the active event | `row_level_security_test.sql` 17 | pass |
| AC4 every public table has RLS on (`pg_tables`) | `row_level_security_test.sql` 1-2 | pass |

- With migration: 143/143 pgTAP checks pass across all 10 files (`pgtap-with-migration.log`).
- Without migration: RLS files fail 18 of 40 (`pgtap-without-migration.log`).
- `npm run verify`: lint, typecheck, 85/85 unit tests green.
- How: the local DB is shared with other lanes, so `run-pgtap-rollback.sh` applies the migration and every test file inside one transaction that is rolled back.
