# Issue #16 QA v1 — head e294c0f

| Check | Result |
|---|---|
| `npm run verify` | ✅ lint, typecheck, vitest 157 passed / 1 skipped |
| pgTAP `supabase/tests/pledge_sponsorship_test.sql`, migration `20261024160000` applied in a rolled-back transaction on local DB | ✅ 13/13 (`pgtap.txt`) |
| `npx playwright test e2e/sponsor-pledge-qa.spec.ts --workers 1` (E2E_AUTH=1, local Supabase, port 3136) | ✅ 4/4 (`e2e.txt`) |

## AC ledger
| AC | Unit | DB (pgTAP) | e2e |
|---|---|---|---|
| AC1 3 tables, 3 different tokens | `src/app/sponsor/actions.test.ts` | ok 1, ok 2 | `e2e/sponsor-pledge-qa.spec.ts:91` (3 links, 3 distinct tokens, 3 rows, 2 Gold) |
| AC2 only hashes stored; raw token only in the link | `src/app/sponsor/actions.test.ts` | ok 11 | `e2e/sponsor-pledge-qa.spec.ts:91` (stored hashes = SHA-256 of the link tokens; no row or audit entry holds a raw token) |
| AC3 over-inventory pledge rejected, creates nothing | `src/lib/sponsor/pledge.test.ts` | ok 7–9 | `:135` page went stale then pledge refused, no sponsor/sponsorship; `:154` 3 concurrent RPCs for the last table: 1 wins, 2 get P0001 |
| AC4 confirmation shows amount + offline payment | — | ok 3, ok 4 | `:91` "Pledged amount: $5,500" + "Payment is collected offline"; `:174` at 1920/1024/375, no horizontal scroll |

## Test gaps (not written)
- Medium: `/invite/<token>` links on the confirmation 404 today — no `src/app/invite` route yet (guest registration card, not this one's AC).
- Low: local Supabase is shared by parallel QA lanes and holds one active gala; another lane's pledges can shift "tables left" mid-test. Run this spec with `--workers 1` and no other lane pledging.
- Note: QA left `pledge_sponsorship()` applied to the local dev DB (additive; another local lane was calling it). No shared/staging DB touched.
