# Issue #17 QA v1 — head ac58d29

| Check | Result |
|---|---|
| `npm run verify` | ✅ lint, typecheck, vitest 212 passed / 1 skipped |
| `npx vitest run src/lib/sponsor` | ✅ 16/16 (`vitest.txt`) |
| `npx playwright test e2e/sponsor-dashboard.spec.ts e2e/sponsor-dashboard-qa.spec.ts` (E2E_AUTH=1, local Supabase, prod build, port 3100) | ✅ 8/8 (`e2e.txt`) |

## AC ledger
| AC | Unit | e2e |
|---|---|---|
| AC1 3 tables, 3 cards across sponsorships | `src/lib/sponsor/dashboard.test.ts:21` | `e2e/sponsor-dashboard.spec.ts:98` (2 sponsorships + a cancelled one → 3 cards) |
| AC2 12 guests → "12 registered / 10 capacity" | `src/lib/sponsor/dashboard.test.ts:34` | `e2e/sponsor-dashboard.spec.ts:111` (12 listed guests) |
| AC3 second sponsor sees none of the first's tables or guests | n/a: RLS + query | `e2e/sponsor-dashboard.spec.ts:123`; QA: `e2e/sponsor-dashboard-qa.spec.ts:80` admin-sponsor sees only own table, `:95` admin with no tables sees the empty state |
| AC4 empty state links to `/sponsor` | `src/lib/sponsor/dashboard.test.ts:62` | `e2e/sponsor-dashboard.spec.ts:142` |

## Test gaps written (High, seen red first)
- Admin who sponsors: RLS shows admins every sponsor's tables. Dropping `.eq("sponsorships.sponsors.user_id", userId)` (`src/lib/sponsor/dashboard.ts:71`) turns `sponsor-dashboard-qa.spec.ts:80` and `:95` red.
- Past gala: dropping `.eq("event_id", eventId)` (`dashboard.ts:69`) turns `sponsor-dashboard-qa.spec.ts:107` red.

## Test gaps (not written)
- Medium: the issue's Fix names "the table link" on each card; the page does not show it (only the token hash is stored). Not an AC; the Builder defers it to #18.
- Medium: a failed query throws to the error boundary; no test pins the error state.
- Low: guest order inside a card follows DB return order (no `order`), and guest rows are keyed by index.

Screenshots: `desktop.png` 1920×1080, `tablet.png` 1024×768, `mobile.png` 375×667 — 3 cards, guests expanded, no horizontal scroll.
