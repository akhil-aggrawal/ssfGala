# QA v1 · issue 51

| AC | Result | Proof |
|---|---|---|
| 1 server start fails with clear log when E2E_AUTH=1 and RAILWAY_ENVIRONMENT set | pass | `ac1-start.log`: built app exits code 1, log `refusing to start ... E2E_AUTH=1 is not allowed on a deployed environment` |
| 2 /auth/test-signin 404 when RAILWAY_ENVIRONMENT set | pass | unit `route.test.ts` and `env.test.ts` (`unit.log`); server cannot be started with both flags, so route guard is covered at unit level |
| 3 local E2E_AUTH=1 still signs in a .test user | pass | `e2e.log`: 30 passed, 3 skipped (screenshot capture) with local Supabase |

Local tests: `npm run verify` (67 pass); `E2E_AUTH=1 npx playwright test` (30 pass).
Note: build with E2E_AUTH=1 in env (as playwright does); a build without it prerenders the route as a static 404.
