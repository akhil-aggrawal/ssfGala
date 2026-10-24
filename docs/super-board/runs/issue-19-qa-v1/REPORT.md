# QA #19 v1 · PR #82 @ eacf35d

Local Supabase (migrations in sync), app built with `E2E_AUTH=1` on port 3100.

| AC | Test | Result |
|---|---|---|
| 1 valid token shows sponsor and tier | `e2e/invite-landing.spec.ts:66` | pass |
| 2 back on `/invite/<same token>` after sign-in | `e2e/invite-landing.spec.ts:74` (test sign-in) · QA `e2e/invite-landing-qa.spec.ts:62` (Google button sends OAuth `redirect_to=/auth/callback?next=/invite/<token>`) | pass |
| 3 unknown token: not-valid message + contact hint | `e2e/invite-landing.spec.ts:89`, `:98` (cancelled sponsorship) | pass |
| 4 closed event: closed message, no form | `e2e/invite-landing.spec.ts:105` · QA `e2e/invite-landing-qa.spec.ts:76` (signed in, still no form) | pass |
| WCAG AA (repo convention) | QA `e2e/invite-landing-qa.spec.ts:85` axe on open, invalid, closed at 1920 and 375 | pass |

Runs: `npm run verify` 239 passed, 1 skipped (`verify.txt`). Playwright invite + auth specs 32 passed, 3 skipped (`playwright.txt`).

## Test gaps (not written)
- Medium: the contact hint names the gala team but gives no email or link, so a guest with a bad link has nowhere concrete to go.
- Low: a real Google round trip (Supabase redirect allowlist on hosted envs) is not exercised; the OAuth request is stubbed at `/auth/v1/authorize`. Covered by #7 for the general return path.
