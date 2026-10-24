# Issue #26 QA v1 — head d627dae

| Check | Result |
|---|---|
| `npm ci && npm run verify` | ✅ lint, typecheck, vitest 155 passed / 1 skipped |
| pgTAP `supabase/tests/admin_attendee_edit_cancel_test.sql`, migration `20261024126000` applied in a rolled-back transaction on local DB | ✅ 14/14 (`db-tests.txt`) |
| `npx playwright test e2e/admin-attendees-qa.spec.ts` (E2E_AUTH=1, local Supabase, port 3126) | ✅ 3/3 (`playwright.txt`) |
| Mutant: drop `.eq("event_id", eventId)` in `loadAttendees` | ✅ caught, AC1 e2e red (`mutant-no-event-scope.txt`), source restored |

## AC ledger
| AC | Unit | DB (pgTAP) | e2e |
|---|---|---|---|
| AC1 partial name/email search, active event only | `src/lib/admin/attendees.test.ts:30` | ok 4 (event scope on writes) | `e2e/admin-attendees-qa.spec.ts:109` |
| AC2 cancel sets `cancelled_at`, keeps payment rows | `src/app/admin/attendees/actions.test.ts:84` | ok 7–10 | `e2e/admin-attendees-qa.spec.ts:168` |
| AC3 edit writes audit row with before and after | `src/app/admin/attendees/actions.test.ts:38` | ok 1–2 | `e2e/admin-attendees-qa.spec.ts:137` |
| AC4 cancelled hidden by default, shown with filter | `src/lib/admin/attendees.test.ts:35` | n/a: UI filter | `e2e/admin-attendees-qa.spec.ts:168` |

## Test gaps (not written)
- Medium: the "Saved." message disappears when an edit moves the row out of the current search (search `omar.x`, change email to `omar.fixed.x`): the list re-renders with "No attendees match." and no confirmation.
- Medium: `loadAttendees` mapping (registration `status = 'cancelled'` marks the row cancelled; assigned table wins over sponsored table) has no unit test.
- Low: a concurrent `supabase db reset` from another worktree wiped the local DB mid-run; QA re-applied `20261024126000` and re-ran.
