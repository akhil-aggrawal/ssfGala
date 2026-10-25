# QA v1: #88 gate re-stamp keeps approval, migrates last

Tested head `0b3d669` (PR #93). Non-visual change (shell and Python gate scripts), so there are no screenshots.

| AC | Test (`test/super-board-merge-gate-restamp.test.ts`) | Result |
|---|---|---|
| 1 approved at H, base merge + rename only, no second `done` | merges a PR approved at H whose only gate changes are a base merge and a rename · still honours the approval for H on a re-run after its pushed re-stamp failed verification | pass |
| 2 any other change after H asks again (exit 7) | asks again (exit 7) and migrates nothing when the PR gained any other change after H · does not carry an approval across a rename that also edits the migration's SQL (QA added) | pass |
| 3 exit 7/8 for approval runs no migrate | the two above · exits 7 and migrates nothing when the approval is withdrawn while verification runs (QA added) · exits 8 for a human step before any allowed env is migrated | pass |
| 4 approved migration PR still migrates, then merges | AC1 test asserts `migrated == [mergedHead]` · migrates and merges once a human approved the human step | pass |

Regression proof: the QA-added withdrawn-approval test run against the pre-fix scripts (`43be12c`) fails with `expected [ Array(1) ] to deeply equal []`: the old gate migrated before its final approval recheck.

Logs: `verify.log` (lint, typecheck, 315 unit tests) · `gate-restamp.log` (22/22).
