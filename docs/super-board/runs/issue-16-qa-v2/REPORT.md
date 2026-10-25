# Issue #16 QA v2 — head 686d521 (staging merged in after v1)

| Check | Result |
|---|---|
| `npm ci && npm run verify` | ✅ lint, typecheck, vitest 185 passed / 1 skipped (`verify.txt`) |
| pgTAP `supabase/tests/pledge_sponsorship_test.sql` with migration `20261024160000` in one rolled-back transaction, local DB | ✅ 13/13 (`pgtap.txt`) |
| `npx playwright test e2e/sponsor-pledge-qa.spec.ts --workers 1` (E2E_AUTH=1, local Supabase, `next start` port 3136) | ✅ 4/4 (`e2e.txt`) |

## AC ledger
| AC | Unit | DB (pgTAP) | e2e |
|---|---|---|---|
| AC1 3 tables, 3 different tokens | `src/app/sponsor/actions.test.ts` | ok 1, ok 2 | `e2e/sponsor-pledge-qa.spec.ts:91` |
| AC2 only hashes stored; raw token only in the link | `src/app/sponsor/actions.test.ts` | ok 11 | `:91` stored hashes = SHA-256 of link tokens |
| AC3 over-inventory pledge rejected, creates nothing | `src/lib/sponsor/pledge.test.ts` | ok 7–9 | `:135` stale page refused; `:154` 3 racing RPCs, 1 wins |
| AC4 confirmation shows amount + offline payment | — | ok 3, ok 4 | `:91` "$5,500" + "Payment is collected offline"; `:174` 1920/1024/375 |

## What v2 re-checked
- Merge of staging (`91e44b2`) kept both `add_admin_attendees` and `pledge_sponsorship` in `database.types.ts`; typecheck clean.
- Merged `globals.css`: form and confirmation render on all three viewports (screenshots here).
- Migration `20261024160000` still sorts after every staging migration.

## Test gaps (not written)
- Medium: `/invite/<token>` links 404 until the guest registration card lands (not this card's AC).
- Low: shared local Supabase; run this spec with `--workers 1` and no other lane pledging.
- Note: `pledge_sponsorship()` applied to the local dev DB only (additive) for the e2e run. No staging DB touched.
