# Issue #28 · QA v2 · PR #70 @ a7493dd

Result: ❌ failing (one High gap, AC1–AC4 themselves pass)

| AC | Proof | Result |
|---|---|---|
| AC1 table number shows for all its guests | e2e `admin-seating.spec.ts:104` · pgTAP ok 1 | ✅ |
| AC2 moving one guest changes only that guest | e2e `:116` · pgTAP ok 3-5, 7 · `ac2-after-move-desktop.png` | ✅ |
| AC3 overbooked badge only in admin | e2e `:130`, `:141`, `:162` · `ac3-*.png` | ✅ on /admin/tables · ❌ /admin overview disagrees (gap H1) |
| AC4 every assignment and move audited | e2e `:169` · pgTAP ok 2, 6, 8 | ✅ |

R1 (no sideways scroll): scrollWidth == innerWidth at 1920, 1024 and 375 (e2e `:153`).

## Gaps

- High H1 · after moving guests off an overbooked table, /admin/tables shows none overbooked but the
  /admin overview still says "Overbooked tables 1". `src/lib/admin/overview.ts:39-43` counts every active guest of the
  table and never reads `assigned_table_number`. Red test: `src/lib/admin/seating.test.ts`
  "agrees with the admin overview on how many tables are overbooked after a move". Fix: count seats in
  `computeOverview` with the same rule as `buildSeating` (select `assigned_table_number` and `physical_table_number`).
  Evidence: `gap-seating-none-overbooked-desktop.png` vs `gap-overview-after-move-desktop.png` (same data: 3 guests on a table of 2, one moved to 8).
- Medium M1 · a guest moved INTO another sponsored table's number is not counted there, so a table can
  be over capacity with moved-in guests and show no badge (`seating.ts:66-70`). Product call.
- Low L1 · the overview counts tables of cancelled sponsorships; the seating page hides them.

## Runs

- `e2e.log` 8/8 (`E2E_AUTH=1 npx playwright test e2e/admin-seating.spec.ts`)
- `pgtap.log` 16/16 (`supabase/tests/seating_test.sql`)
- `vitest.log` seating + actions + overview
- `npm run verify` green at `a7493dd` (188 passed) before the red test was added
