# Issue #72 QA v1

Branch `issue-72-malformed-reads-any-kind` at `58e6621`. Non-visual change: no screenshots.

| AC | Result | Proof |
|---|---|---|
| 1 quota + plain-text `--jq` exits 64, no halt file | ✅ | test "exits 64 on the first attempt when --kind quota…"; live gh run: `--kind quota -- api rate_limit --jq '"x"'` printed exit=64, no halt file |
| 2 gh usage error, kind not in FORMS, exits 64 | ✅ | test "exits 64 on the first attempt for a gh usage error…" |
| 3 GraphQL literal `{owner}`/`{repo}` exits 64; auth/permission still halt | ✅ | tests "exits 64 for a graphql query…" (0 gh calls) and "still halts on the first attempt for real auth and permission errors" |
| 4 `SB_GITHUB_READ_STRICT=1` still exits 79 + halt file | ✅ | test "still halts with exit 79 under SB_GITHUB_READ_STRICT=1"; live gh run: exit=79 after 3 attempts, halt file written (temp path) |
| 5 5xx / timeout retries 3 times, exits 79 | ✅ | tests "retries an HTTP 5xx on a kind not in FORMS…" and "retries a timeout…" |

## Added by QA
- Test: a kind not in FORMS that gets JSON of the wrong shape (no `--jq`) retries 3 times, then exits 64 without a halt file. Red on `staging`, green on the branch.
- The 4 new "any kind" tests all fail against the `staging` helper, so they test the fix.

## Finding (Medium, not in an AC)
`placeholder_query()` flags `{owner}`/`{repo}` in any `query=` arg, including `-F query=…`. gh fills placeholders in `-F` values, so that read is valid:
- raw `gh api graphql -F query='query{repository(owner:"{owner}",name:"{repo}"){nameWithOwner}}'` returns `akhil-aggrawal/ssfGala`, exit 0
- the same read through the helper exits 64 with "pass owner and name as -F variables"
- the comment at `super-board-github-read.py:299` ("gh fills {owner}/{repo} only in a REST path") is wrong for `-F`
- Fix: only flag a `query=` value that follows `-f` / `--raw-field`. No caller in the repo uses the `-F` form today.

## Logs
- `helper-tests.log` — 16/16 helper tests pass
- `verify.log` — `npm run verify`: 193 passed, 1 skipped
