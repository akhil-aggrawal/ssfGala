# Issue #28 · QA v4 · PR #70 @ 50eb534

Result: ✅ passing. Reviewer R6 (a guest moved onto a full table showed no Overbooked badge) is fixed, now with an e2e.

| AC | Proof | Result |
|---|---|---|
| AC1 table number shows for all its guests | e2e `admin-seating.spec.ts:104` · pgTAP `seating_test.sql` | ✅ |
| AC2 moving one guest changes only that guest | e2e `admin-seating.spec.ts:116` · `admin-seating-qa.spec.ts:119` blank move puts the guest back | ✅ |
| AC3 overbooked badge only in admin | e2e `admin-seating.spec.ts:130,141,162` · `admin-seating-qa.spec.ts:103` overview == seating after a move · new `admin-seating-qa.spec.ts:154` moved onto a full table: destination 3 / 2 Overbooked, source 2 / 2, overview agrees · unit `seating.test.ts:110,118` | ✅ |
| AC4 every assignment and move audited | e2e `admin-seating.spec.ts:169` · `admin-seating-qa.spec.ts:128,139` | ✅ |

## Test check

- New e2e `admin-seating-qa.spec.ts:154` seen red: with `countSeated` not counting moved-in guests, it failed on `3 / 2Overbooked` (received `2 / 2`); code restored, green.
- Screenshot steps now wait for the loaded table and the filter nav (v3's filter shot could catch "Checking access...").

## Test gaps (not written)

- Low · two live tables share one physical number: a moved guest counts at the first by id only (`src/lib/admin/overview.ts` `countSeated`). Admin data entry; no AC.
- Low · table numbers match case-sensitively (`vip-1` is not `VIP-1`).

## Runs

- `verify.log` `npm run verify` green (255 passed, 1 skipped)
- `pgtap.log` `supabase test db` 236/236 after `supabase db reset` on this branch
- `e2e.log` 33 passed (`admin-seating`, `admin-seating-qa`, `admin-dashboard-qa`, `--workers=1`, `E2E_AUTH=1`)
