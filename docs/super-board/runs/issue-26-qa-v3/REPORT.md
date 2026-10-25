# Issue #26 QA v3 — head 67ee9e5 (staging 6003ed3 merged, migration re-timestamped)

| Check | Result |
|---|---|
| `npm ci && npm run verify` | ✅ lint, typecheck · vitest 482 passed / 20 skipped (`verify.txt`) |
| `super-board-local-db.sh scratch` · `supabase db reset` + `supabase test db` | ✅ `20261024210001_admin_attendee_edit_cancel.sql` applies last, after `20261024210000`; pgTAP 382/382, 27 files, incl. `admin_attendee_edit_cancel_test.sql` (`db-tests.txt`) |
| `super-board-local-db.sh lock` · main DB reset to this branch, then `npx playwright test e2e/admin-attendees-list-qa.spec.ts e2e/admin-attendees-qa.spec.ts` (E2E_AUTH=1, port 3226) | ✅ 7/7 (`playwright.txt`, `db-reset-main.txt`); main DB reset back to staging after |

## What changed since v2
- Merge of staging `6003ed3`: `globals.css` keeps staging's blocks and appends the `.attendee-*` block. No selector clash (`.attendee` from staging vs `.attendee-filters` / `.attendee-form` / `.attendee-actions` here). Screens at three viewports render the filter and table as in v2.
- Migration renamed `20261024126000` → `20261024210001`, content unchanged (`git diff 9ad7ff1 67ee9e5`: rename only).

## AC ledger (unchanged from v2)
| AC | Unit | DB (pgTAP) | e2e |
|---|---|---|---|
| AC1 partial name/email search, active event only | `src/lib/admin/attendees.test.ts:30` | ok 4 | `e2e/admin-attendees-list-qa.spec.ts:109` |
| AC2 cancel sets `cancelled_at`, keeps payment rows | `src/app/admin/attendees/actions.test.ts:84` | ok 7–10 | `e2e/admin-attendees-list-qa.spec.ts:168` |
| AC3 edit writes audit row with before and after | `src/app/admin/attendees/actions.test.ts:38` | ok 1–2 | `e2e/admin-attendees-list-qa.spec.ts:137` |
| AC4 cancelled hidden by default, shown with filter | `src/lib/admin/attendees.test.ts:35` | n/a: UI filter | `e2e/admin-attendees-list-qa.spec.ts:168` |

## Test gaps (not written)
- Medium (from v1): "Saved." disappears when an edit moves the row out of the current search.
- Medium (from v1): `loadAttendees` mapping (registration `status = 'cancelled'`; assigned table wins over sponsored table) has no unit test.
