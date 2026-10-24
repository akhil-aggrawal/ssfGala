# Issue #1 QA v2, against `6c8cdf0` (after reviewer bounce R1, rebuild 1)

| AC | Result | Proof |
|---|---|---|
| 1. `npm run verify` exits 0 on a clean checkout | pass | fresh worktree, `npm ci && npm run verify` exit 0, 7 tests (`verify.txt`) |
| 2. `GET /` returns 200 with placeholder text in a Playwright smoke test | pass | `e2e/smoke.spec.ts:3` 1 passed (`playwright.txt`); `curl` 200 + `<h1>` (`http-get-root.txt`) |
| 3. CI runs `npm run verify` on every pull request | pass | `verify` check run 120741114062 success on `6c8cdf0`; guarded by `test/scaffold.test.ts` "CI workflow" |
| 4. `.env.example` lists every architecture-doc variable, no real values | pass | 9 names, all blank; guarded by `test/scaffold.test.ts` ".env.example" |

## R1 (reviewer bounce) re-check
Nested `.claude/worktrees/issue-9-build/` with a copied `.next` build, a type error and a lint error: `npm run verify` exit 0.
Controls: same type error in `src/` makes verify exit 2; dropping `.claude/worktrees` from tsconfig `exclude` turns vitest red (`r1-nested-worktree.txt`).

## Test-gap ledger
| AC | unit | e2e |
|---|---|---|
| 1 | n/a: the command is the test | n/a |
| 2 | none | `e2e/smoke.spec.ts:3` |
| 3 | `test/scaffold.test.ts` CI workflow | n/a |
| 4 | `test/scaffold.test.ts` .env.example | n/a |

No High gaps.

## Test gaps (not written)
- Medium: CI runs `npm run verify` only; the Playwright smoke test is not run in CI.
