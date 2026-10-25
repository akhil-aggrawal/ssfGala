# Issue #72 QA v2

Branch `issue-72-malformed-reads-any-kind` at `49ca95f` (rebuild 1, after reviewer R1). Non-visual change: no screenshots.

| AC | Result | Proof |
|---|---|---|
| 1 quota + plain-text `--jq` exits 64, no halt file | ✅ | test "exits 64 on the first attempt when --kind quota…"; live gh: exit 64, no halt file |
| 2 gh usage error, kind not in FORMS, exits 64 | ✅ | test "exits 64 on the first attempt for a gh usage error…"; live gh `--bogus`: exit 64 |
| 3 GraphQL literal `{owner}`/`{repo}` exits 64; auth/permission still halt | ✅ | tests "exits 64 for a graphql query…", "flags … every raw-field spelling", "still halts … auth and permission"; live `-f`: exit 64, 0 gh calls |
| 4 `SB_GITHUB_READ_STRICT=1` still exits 79 + halt file | ✅ | test "still halts with exit 79 under SB_GITHUB_READ_STRICT=1"; live: both reads exit 79, halt file written (temp path) |
| 5 5xx / timeout retries 3 times, exits 79 | ✅ | tests "retries an HTTP 5xx on a kind not in FORMS…", "retries a timeout…" |

## R1 (reviewer bounce) re-check
- `-F` / `--field` / `--field=` `query=…{owner}…` now reaches gh: test "lets -F/--field query=…{owner}… reach gh"; live gh returns `akhil-aggrawal/ssfGala`, exit 0.

## Red on staging
6 of 18 helper tests fail with the `staging` helper swapped in (restored after): the any-kind, placeholder and `-F` tests. All 18 pass on the branch.

## Test gaps (not written)
- Medium: fixed-command scripts that do not set `SB_GITHUB_READ_STRICT` (super-qa-file-bug.sh, super-review-file-refactor.sh `--kind dedupe`; super-board-gh-guard.sh `--kind quota`; super-board-deps.sh `--kind issues`) now exit 64, not 79, on a payload that keeps the wrong shape. Each uses `|| exit $?`, so no write follows; the run just is not halted.
- Low: `{branch}` placeholder, `-q`/`--template` short forms of `--jq`, and `-Fquery=` attached form have no test (surviving mutants if dropped).

## Logs
- `helper-tests.log`: 18/18 helper tests pass
- `verify.log`: `npm run verify` 195 passed, 1 skipped
- `live-gh.log`: real gh runs per AC
