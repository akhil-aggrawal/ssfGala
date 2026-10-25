# Issue #26 QA v2 — head 656ae0a (staging merged in)

| Check | Result |
|---|---|
| `npm ci && npm run verify` | ✅ lint, typecheck · vitest 182 passed / 1 skipped; `test/scaffold.test.ts` "ignored by ESLint" timed out at 5 s under load avg 80, passes on rerun (`verify.txt`); file not touched by this PR |
| pgTAP `supabase/tests/admin_attendee_edit_cancel_test.sql`, migration `20261024126000` applied in a rolled-back transaction on top of `20261024120000` (#25) and `20261024128000` | ✅ 14/14 (`db-tests.txt`) |
| `npx playwright test e2e/admin-attendees-list-qa.spec.ts e2e/admin-attendees-qa.spec.ts` (E2E_AUTH=1, local Supabase, port 3226) | ✅ 7/7 (`playwright.txt`) |
| Full e2e suite, same server | ✅ 96 passed, 12 skipped (`playwright-full.txt`) |

## Merge regression found and fixed (test only)
The #25 spec `e2e/admin-attendees-qa.spec.ts:79` failed after the merge (`playwright-before-locator-fix.txt`):
`getByLabel("Complimentary")` and `getByLabel("Tier")` also matched the #26 filter selects, because the list page
stays mounted (hidden) after client navigation to `/admin/attendees/new`. Fixed with `getByRole("radio", …)` and
`getByLabel("Tier", { exact: true })`. No app code changed.

## AC ledger
| AC | Unit | DB (pgTAP) | e2e |
|---|---|---|---|
| AC1 partial name/email search, active event only | `src/lib/admin/attendees.test.ts:30` | ok 4 | `e2e/admin-attendees-list-qa.spec.ts:109` |
| AC2 cancel sets `cancelled_at`, keeps payment rows | `src/app/admin/attendees/actions.test.ts:84` | ok 7–10 | `e2e/admin-attendees-list-qa.spec.ts:168` |
| AC3 edit writes audit row with before and after | `src/app/admin/attendees/actions.test.ts:38` | ok 1–2 | `e2e/admin-attendees-list-qa.spec.ts:137` |
| AC4 cancelled hidden by default, shown with filter | `src/lib/admin/attendees.test.ts:35` | n/a: UI filter | `e2e/admin-attendees-list-qa.spec.ts:168` |

## Test gaps (not written)
- Medium (from v1): "Saved." disappears when an edit moves the row out of the current search.
- Medium (from v1): `loadAttendees` mapping (registration `status = 'cancelled'`; assigned table wins over sponsored table) has no unit test.
- Low: `test/scaffold.test.ts` ESLint check uses the 5 s default timeout and flakes under heavy load.
