# Issue #24 QA v1 — admin dashboard shell and overview metrics

Tested head `7c2d548` (branch `issue-24-admin-dashboard-shell`), local Supabase, `next start` with E2E_AUTH=1.

| AC | Result | Proof |
|---|---|---|
| 1 Each sidebar link routes to its page | pass | `e2e/admin-dashboard.spec.ts:39` clicks all 7 links (URL, h1, aria-current); `nav-items.test.ts` each href has a page; QA spec: all 6 placeholders redirect signed-out and 403 a sponsor (`e2e/admin-dashboard-qa.spec.ts:56`) |
| 2 Stripe collected = succeeded Stripe payments, active event | pass | `overview.test.ts:32` (pending/failed/refunded/offline excluded); `overview.db.test.ts` second event does not leak in; QA spec page value = `loadOverview(activeEvent)` |
| 3 Outstanding = committed pledges − succeeded offline receipts | pass | `overview.test.ts:62`, `:83` (per-pledge floor); `overview.db.test.ts` 400000 |
| 4 Overbooked = tables with > capacity active attendees | pass | `overview.test.ts:116` (exactly-at-capacity not counted, cancelled guest/registration excluded); `overview.db.test.ts` 1 |

Runs: `npm run verify` 103 pass · `DB_TESTS=1 vitest run src/lib/admin` 11 pass · `E2E_AUTH=1 playwright test` 64 pass.

Mutation: placeholder without `requireRole` → 6 sponsor-403 tests red (`mutant-placeholder-no-guard.txt`); restored.

Test gaps (not written):
- Medium: local active event has no rows, so the page-level value check compares zeros; nonzero values are pinned at the `loadOverview` rung (db test) only. Seeding the shared active event would leave undeletable payment rows.
- Low: no loading/error state test for a failed overview query (it throws to the error boundary by design).

Env note: Stripe/Resend/app-URL keys were set to dummy values for `next start`; no route under test reads them.
