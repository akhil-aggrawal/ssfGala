# Issue #23 QA v1

Head tested: `0bf156d` (branch `issue-23-sponsors-edit-remove-guests`), local Supabase, prod build with `E2E_AUTH=1`.

| Check | Result | Evidence |
|---|---|---|
| `npm ci && npm run verify` | ✅ lint, typecheck, 352 unit tests | `verify.log` |
| migrations + pgTAP on scratch DB | ✅ 21 files, 312 tests (incl. `sponsor_guest_edits_test.sql`) | `pgtap.log` |
| `e2e/sponsor-guest-edits-qa.spec.ts` + sponsor dashboard specs | ✅ 12/12 | `e2e.txt` |
| mutant: paid Remove not disabled | ❌ AC2 spec red as expected | `mutant-ac2.txt` |
| mutant: owner check dropped in SQL | ❌ AC3 spec red as expected | `mutant-ac3.txt` |

| AC | Unit | pgTAP | e2e |
|---|---|---|---|
| 1 unpaid removal soft-cancels, count drops | `dashboard.test.ts` (cancelled filtered) | `sponsor_guest_edits_test.sql` cancelled_at + count | `sponsor-guest-edits-qa.spec.ts` AC1 |
| 2 paid removal refused, also over the API | `actions.test.ts` paid message | paid refused; `authenticated` gets 42501 | disabled button + reason; PostgREST RPC with sponsor token refused; re-enabled button refused |
| 3 no edit/remove on another sponsor's table | `actions.test.ts` owner from session | P0002 for edit and remove | tampered form id refused for edit and remove, row unchanged |
| 4 audit row with before/after | — | update + cancel rows | update + cancel rows via UI |

## Test gaps (not written)
- Medium: a guest with only a pending payment can be removed; if the webhook later succeeds, a cancelled guest is paid. Witness: allocation on `status='pending'` payment, remove, then mark succeeded.
- Medium: no test pins `sp.status = 'committed'` or `r.status <> 'cancelled'` in `sponsor_lock_guest` (dropping either survives).
- Medium: no test that a failed/refunded payment still allows removal (dropping the `status='succeeded'` filter survives).
- Low: edit email format is checked only in the app, not in SQL.
