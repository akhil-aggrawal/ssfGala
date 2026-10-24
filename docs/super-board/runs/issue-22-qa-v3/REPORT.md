# Issue #22 QA v3 — head 24a3c7b

| Check | Result |
|---|---|
| `npm run verify` | ✅ lint, typecheck, vitest 133 passed / 1 skipped |
| pgTAP `audit_log_writer_test.sql`, migration `20261024110000` re-applied in a rolled-back transaction on local DB | ✅ 8/8 |
| `npx playwright test e2e/admin-audit.spec.ts e2e/admin-audit-qa.spec.ts` (E2E_AUTH=1, local Supabase, port 3122) | ✅ 6/6 |

Since v2 (`8e62b08`): staging merged, migration renamed `20261023180000` → `20261024110000` (content identical), `database.types.ts` keeps both `record_audit_log` and `save_gala_setup`. No app-code change.

## AC ledger
| AC | Unit | DB (pgTAP) | e2e |
|---|---|---|---|
| AC1 one row with actor, action, entity type/ID, before/after | `src/lib/audit.test.ts:28` (read path) | `supabase/tests/audit_log_writer_test.sql` ok 1, ok 2 | `e2e/admin-audit.spec.ts:89-90`, `e2e/admin-audit-qa.spec.ts:66` |
| AC2 rollback leaves no audit row | n/a: SQL transaction | ok 3–7 | n/a |
| AC3 newest 100, active event, admins only | `src/lib/audit.test.ts:28` | n/a | `e2e/admin-audit.spec.ts:62,68,75`, `e2e/admin-audit-qa.spec.ts:59,79` |

## Test gaps (not written)
- Medium: e2e leaves an open event in the local DB, which trips `one_active_gala` for later pgTAP runs (QA archived its own leftover after this run).
- Low: `src/lib/audit.ts:10` names the old migration file `20261023160000_audit_log_writer.sql`; it is now `20261024110000_audit_log_writer.sql`.
- Low: local server needs Stripe/Resend env names set to start (`src/lib/env.ts`); QA used dummy values.
