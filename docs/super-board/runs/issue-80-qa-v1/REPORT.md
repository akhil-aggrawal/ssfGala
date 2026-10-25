# QA v1 · issue #80 · PR #83 @ fe4b876

| AC | Result | Proof |
|---|---|---|
| 1 e2e spec `service_role` → no auth hold | ✅ | `test/super-board-merge-policy.test.ts` "gives no auth hold…"; real PR #79 diff: old holds auth, new holds nothing (`real-diffs.log`) |
| 2 `test/**/*.test.ts` `drop table` → no schema hold | ✅ | "gives no schema hold…"; real PR #83 diff: old holds auth+schema, new holds nothing |
| 3 migration / src `service_role` → auth hold | ✅ | "still holds service_role in a migration or src file" |
| 4 `keyword_exclude: []` → every line searched | ✅ | "searches every added line again…" |
| 5 label / path still hold | ✅ | "still holds on labels and paths…" |

Added by QA:
- `+++ b/e2e/x.spec.ts` content line inside a src hunk cannot relabel the file. Red when the `not in_hunk` guard is removed.
- Multi-file diff: each hunk is checked against its own file.

Mutation: the staging policy fails 3 of 7 tests; dropping the in-hunk guard fails 1.

Full suite: `npm run verify`: lint, typecheck and 235 tests pass, 1 skipped.
