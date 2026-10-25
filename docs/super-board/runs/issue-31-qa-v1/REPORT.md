# QA v1 — #31 admin CSV and Excel exports (PR #103 @ a0e9aec)

| AC | Result | Proof |
|---|---|---|
| AC1 roster CSV: one row per active attendee with name, email, tier, kind, table, paid | ✅ | `admin-exports.spec.ts` header `Name,Email,Tier,Kind,Sponsor,Table,Paid` + seeded guest row · `admin-exports-qa.spec.ts` cancelled guest left out, live guest present · `exports.test.ts` roster case |
| AC2 XLSX opens with one sheet per report | ✅ | `admin-exports-qa.spec.ts` 9 distinct worksheet parts · downloaded workbook opened in openpyxl: 9 sheets (Table allocations by tier … Overbooked tables), Roster header row correct · `xlsx.test.ts` |
| AC3 non-admin gets 403 | ✅ | sponsor 403 on roster.csv, balances.csv, reports.xlsx (`admin-exports.spec.ts`) · signed-in no-role user 403 (`admin-exports-qa.spec.ts`) · signed out 307 to sign-in · body has no guest email |
| AC4 audit row naming the report | ✅ | all nine `<report>.csv` URLs write `report.export` rows in order with `after_data.report` (`admin-exports-qa.spec.ts`) · xlsx row `report: all` (`admin-exports.spec.ts`) · no file when audit write fails (`route.test.ts`) |

Runs: `tests.txt` (playwright 13 passed, 3 skipped screenshot-only, prod build on local Supabase, E2E_AUTH=1, placeholder Stripe/Resend keys) · `npm run verify` 444 passed, 15 skipped.

Screenshots: `desktop.png`, `tablet.png`, `mobile.png` of `/admin/exports` as admin.

Test gaps (not written):
- Low: the e2e does not open the workbook in a real spreadsheet app; openpyxl 3.x opened it in QA.
- Low: branch is one commit behind `staging` (ad97044 email); no file overlap.
