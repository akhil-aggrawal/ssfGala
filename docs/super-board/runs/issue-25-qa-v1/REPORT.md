# Issue #25 QA v1 — head e7357d5

| Check | Result |
|---|---|
| `npm ci && npm run verify` | ✅ lint, typecheck, 159/159 unit (1 skipped file is pre-existing) |
| `add_admin_attendees_test.sql` (pgTAP, migration applied in a rolled-back transaction on local Supabase) | ✅ 20/20 (4 added by QA) — `pgtap.log` |
| `npx playwright test e2e/admin-attendees-qa.spec.ts` (E2E_AUTH=1, local Supabase, prod build) | ✅ 4/4 — `e2e.log` |

## AC ledger
| AC | Unit | DB (pgTAP) | e2e |
|---|---|---|---|
| AC1 complimentary → `registered`, no payment row | `src/app/admin/attendees/new/actions.test.ts:54` (no amount sent) | `supabase/tests/add_admin_attendees_test.sql:29,38` | `e2e/admin-attendees-qa.spec.ts:79` |
| AC2 offline payment for the entered amount, `recorded_by` set | `src/lib/admin/attendees.test.ts:30` (cents) | `add_admin_attendees_test.sql:53,57,60` | `e2e/admin-attendees-qa.spec.ts:99,132` |
| AC3 no button or route in the attendees area calls Stripe | `actions.test.ts:85` (no `stripe` in any source) | n/a: no SQL surface | `e2e/admin-attendees-qa.spec.ts:149` (no Stripe request, no charge button) |
| AC4 each creation writes an audit log row | n/a: written in SQL | `add_admin_attendees_test.sql:76` | `e2e/admin-attendees-qa.spec.ts:96,129` |

## Test-gap check
Done in-lane (no sub-agent tool in this worker); money change, so every guard branch was checked.
- High (written): complimentary with an amount, offline under 1 cent per attendee, exactly 1 cent per attendee, empty attendee list — pgTAP. Red against mutants `<`→`<=`, dropped complimentary-amount check, dropped minimum; green on the real function.
- High (written): the form parser's 1-cent-per-attendee guard at 0.01 / 0.02 for two attendees — `src/lib/admin/attendees.test.ts`. Red against `<`→`<=` and a dropped guard.
- Medium (not written): double submit creates two registrations; the form disables while pending but the action has no idempotency key.
- Medium (not written): migration version `20261024120000` is also used by open branches issue-28 (`seating_assignments`), issue-29 (`sponsorship_receipts`) and issue-64. Whichever merges second will clash in `supabase_migrations.schema_migrations`; the later PR must rename its file before merge.
- Low (not written): anon execute grant not asserted (revoked from `public`, which covers it).

## Screenshots
`desktop.png` `tablet.png` `mobile.png` — `/admin/attendees/new` with Paid offline selected. `list-*.png` — `/admin/attendees`.
