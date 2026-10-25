# QA #28 · v1 · head b7ecf60

| AC | Proof |
|---|---|
| 1 table number shows for all its guests | e2e `admin-seating.spec.ts` AC1 · pgTAP ok 1 |
| 2 moving one guest changes only that guest | e2e AC2 · pgTAP ok 3-5, 7 |
| 3 overbooked badge, admin only | e2e AC3 (badge, filter, non-admin 403) · `seating.test.ts` boundary test |
| 4 every assignment and move writes an audit row | e2e AC4 · pgTAP ok 2, 6, 8 |

Logs: `e2e.log` (6/6) · `pgtap.log` (16/16) · `vitest.log` (17/17).
pgTAP ran in one rolled-back transaction on the shared local DB, other lanes were resetting it.
