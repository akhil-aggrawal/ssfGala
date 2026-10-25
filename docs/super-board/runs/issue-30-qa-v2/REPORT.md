# QA v2 — #30 admin reports (PR #102 @ 8ab885c, rebuild for reviewer R1)

| AC | Result | Proof |
|---|---|---|
| AC1 each FR-10 report has a view, totals match seeded data | ✅ | `e2e/admin-reports-qa.spec.ts` AC1+AC2: seeded sponsor rows match and every Total row equals `loadReports` for the active gala · `reports.db.test.ts` (DB_TESTS=1) green |
| AC2 cancelled attendees and failed payments left out | ✅ | R1 fixed: a `pending_payment` ticket buyer (Hal, failed $200 checkout) is now seeded in the e2e and is not on the Roster (`admin-reports-qa.spec.ts:161`) · cancelled Dee and failed/refunded payments still left out · `reports.test.ts` 12/12 |
| AC3 admins only | ✅ | `admin-reports.spec.ts` signed out 307, sponsor 403 · `admin-reports-qa.spec.ts` no-role 403 |

Mutant: `liveRegistrations` back to `status !== "cancelled"` (pre-R1) turns red in unit (2), DB (1) and e2e (Hal on roster): `mutation-pending-payment.txt`.

Runs: `tests.txt` (playwright 8/8 on a prod build with local Supabase, E2E_AUTH=1, placeholder Stripe/Resend keys; vitest 16/16 with DB_TESTS=1; `npm run verify` 421 passed, 15 skipped).

Test gaps (not written):
- Low: `/admin` overview still counts `pending_payment` registrations as active (`overview.ts:73-75`), so its attendee count can exceed the Reports roster by abandoned ticket checkouts. Overbooked tables agree only because pending buyers are `individual` (no sponsored table).
- Low (carried from v1): report headings show twice (h2 and table caption); a dropped active filter in `allocatedTo` would 500 rather than show a wrong total.
