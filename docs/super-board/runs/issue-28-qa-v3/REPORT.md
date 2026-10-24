# Issue #28 · QA v3 · PR #70 @ c1fe836

Result: ✅ passing. The v2 High gap (overview disagreed on Overbooked) is fixed.

| AC | Proof | Result |
|---|---|---|
| AC1 table number shows for all its guests | e2e `admin-seating.spec.ts:104` · pgTAP ok 1 | ✅ |
| AC2 moving one guest changes only that guest | e2e `admin-seating.spec.ts:116` · `admin-seating-qa.spec.ts` blank move puts the guest back · pgTAP ok 3-5, 7 | ✅ |
| AC3 overbooked badge only in admin | e2e `admin-seating.spec.ts:130,141,162` · `admin-seating-qa.spec.ts` overview == seating before and after a move · unit `seating.test.ts` | ✅ |
| AC4 every assignment and move audited | e2e `admin-seating.spec.ts:169` · `admin-seating-qa.spec.ts` before/after rows, bad number writes none · pgTAP ok 2, 6, 8 | ✅ |

## Test gaps (not written)

- Medium M1 · a guest moved INTO another sponsored table's number is not counted there, so that table can sit over capacity with no badge (`src/lib/admin/seating.ts:66-70`). Product call.
- Low L1 · the overview counts tables of cancelled sponsorships; the seating page hides them (`src/lib/admin/overview.ts:76`).

## Merge note

- `issue-28-admin-seating` conflicts with `staging` @ `bb3f8d1` in `src/app/globals.css` and `src/lib/database.types.ts`; migration `20261024128000` sorts before staging's `20261024130000`-`170000` (merge gate re-stamps).

## Runs

- `verify.log` `npm run verify` green (190 passed)
- `pgtap.log` 16/16 `supabase/tests/seating_test.sql`; full `supabase test db` 207/207
- `vitest.log` seating + overview + actions 31/31
- `e2e.log` 24 passed (seating + dashboard specs, `--workers=1`) · 8 passed (`admin-seating-qa.spec.ts` with shots)
- Fixed `admin-dashboard-qa.spec.ts` screenshot step: Tables & Seating is no longer a placeholder, it now opens Payments
