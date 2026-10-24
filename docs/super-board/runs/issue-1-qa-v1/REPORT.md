# Issue #1 QA v1, against `2ea77ad`

| AC | Result | Proof |
|---|---|---|
| 1. `npm run verify` exits 0 on a clean checkout | pass | fresh worktree, `npm ci && npm run verify` exit 0 (`verify.txt`) |
| 2. `GET /` returns 200 with placeholder text in a Playwright smoke test | pass | `e2e/smoke.spec.ts:3` 1 passed (`playwright.txt`); `curl` 200 + `<h1>` (`http-get-root.txt`) |
| 3. CI runs `npm run verify` on every pull request | pass | `verify` check SUCCESS on PR #44 (run 40049256427); guarded by `test/scaffold.test.ts` |
| 4. `.env.example` lists every architecture-doc variable, no real values | pass | Architecture Design v1, "Deployment and observability": Supabase URL / anon / service key, Stripe secret / webhook secret, Google OAuth, Resend, app base URL. All 9 names present, all blank; guarded by `test/scaffold.test.ts` |

Test gaps written (High, no test at any rung): AC3 and AC4. Seen red by mutation (`mutation.txt`).
