# Issue #22 QA v1 — head b07e7c3

| Check | Result |
|---|---|
| `npm run verify` | ✅ lint, typecheck, 88/88 unit |
| `supabase test db` | ✅ 9 files; `audit_log_writer_test.sql` 8/8 (2 added by QA) |
| `npx playwright test e2e/admin-audit.spec.ts` (E2E_AUTH=1, local Supabase) | ✅ 3/3 |

## AC ledger
| AC | Unit | DB (pgTAP) | e2e |
|---|---|---|---|
| AC1 one row with actor, action, entity type/ID, before/after | `src/lib/audit.test.ts:28` (read path) | `supabase/tests/audit_log_writer_test.sql:28,35` | `e2e/admin-audit.spec.ts:89-90` |
| AC2 rollback leaves no audit row | n/a: SQL transaction | `audit_log_writer_test.sql:74,81` + QA: failed audit write rolls back the edit | n/a |
| AC3 newest 100, active event, admins only | `src/lib/audit.test.ts:28` | n/a | `e2e/admin-audit.spec.ts:62,68,75` |

## Test-gap check
- High (written): a failed audit write (FK violation) must roll back the edit before it. Red against an error-swallowing writer mutant (tests 6-7 not ok), green against the real writer.
- Medium (not written): pgTAP suite assumes no open event; running it after e2e (which leaves an open "E2E Gala") fails on `one_active_gala`. Run order: `supabase db reset` first.
- Low (not written): the 403 page header shows "Sign In" to a signed-in sponsor (`sponsor-403-mobile.png`), from the shared layout, not this diff.
