# Issue #6 QA v2: reviewer finding R1

**Head tested:** `9f1e61c` plus the R1 fix commit · base DB at staging migrations through `20261023160000`.

## R1: checks that counted every row
Six checks read whole tables, so rows from other tests or seeds turned them red.
Each now filters to its own fixture event:

| File | Check | Filter added |
|---|---|---|
| `row_level_security_edges_test.sql` | an admin reads the audit log | `event_id = …0710` |
| `row_level_security_edges_test.sql` | a guest cannot see a draft event | `id = …0710` |
| `row_level_security_edges_test.sql` | a guest cannot see a draft event's tiers | `event_id = …0710` |
| `row_level_security_edges_test.sql` | an admin sees the draft event | `id = …0710` |
| `row_level_security_test.sql` | an admin sees every sponsor | `event_id = …0610` |
| `row_level_security_test.sql` | AC3 admin selects every attendee of the active event | `e.id = …0610` |

The reviewer named four. The audit-log check also went red on the shared DB in this run (audit rows now exist), and AC3 had the same pattern, so both are fixed too.

## Results
| Run | Pass | Fail | Log |
|---|---|---|---|
| v1 tests, shared DB, with migration | 138 | 5 | (reproduced R1 plus audit log) |
| v2 tests, shared DB, with migration | 143 | 0 | `pgtap-with-migration-shared-db.log` |
| v2 tests, shared DB, without migration | 125 | 18 | `pgtap-without-migration-shared-db.log` |
| v2 RLS tests + noise rows | 40 | 0 | `pgtap-rls-with-noise-rows.log` |
| v1 RLS tests + noise rows | 35 | 5 | `pgtap-rls-v1-tests-with-noise-rows.log` |
| `npm ci && npm run verify` | 85 | 0 | lint, typecheck, vitest |

Noise rows (`noise-rows.sql`): two archived events, another sponsor, a guest with an attendee, an audit row. Without the migration, the 18 RLS checks still fail, so the tests still catch a missing policy.

`supabase db reset` was skipped because the local DB is shared with other lanes. Every run is one transaction that rolls back.
