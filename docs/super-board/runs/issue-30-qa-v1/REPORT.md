# QA v1 — #30 admin reports (PR #102 @ ae57bc2)

| AC | Result | Proof |
|---|---|---|
| AC1 each FR-10 report has a view, totals match seeded data | ✅ | `e2e/admin-reports-qa.spec.ts` AC1+AC2: a seeded sponsor's rows in Sponsor pledges, Outstanding balances, Offline receipts, Guest contributions, Overbooked tables and Roster match, and every Total row on the page equals `loadReports` for the active gala · `reports.db.test.ts` (DB_TESTS=1) green · `reports-view.test.tsx` lists all nine headings |
| AC2 cancelled attendees and failed payments left out | ✅ | same e2e: cancelled guest Dee not on the roster and her $30 not in contributions; Ben's failed $99 not counted, Paid = No; refunded $700 receipt not received · `reports.test.ts` 11/11 · mutant (count refunded receipts) goes red: `mutation-refunded-receipt.txt` |
| AC3 admins only | ✅ | `admin-reports.spec.ts` signed out 307 to sign-in, sponsor 403 · `admin-reports-qa.spec.ts` signed-in user with no role 403, no table |

Runs: `tests.txt` (vitest 15/15 with DB_TESTS=1, playwright 8/8, prod build, local Supabase, E2E_AUTH=1). `npm run verify`: 420 passed, 15 skipped.

Test gaps (not written):
- Medium: a `pending_payment` registration (ticket checkout failed or abandoned) is listed on the roster and counted in its total with Paid = No (`reports.ts` `liveRegistrations` keeps every non-cancelled status; `reports.test.ts` pins Hal on the roster). Matches the overview's attendee count, so a product call, not a QA fail.
- Low: each report heading shows twice, once as the h2 and once as the table caption (`reports-view.tsx` `<caption>`); could be visually hidden.
- Low: mutant "drop the active-guest filter in `allocatedTo`" crashes the page (non-null `attendeeById.get(id)!`) instead of showing a wrong total; caught, but by a 500.

Screenshots: the local database holds many QA sponsors from earlier runs, so the tables are long.
