# Pre-flight — SsfGala build board (#5)

Written by `super-board lint` on 2026-10-22; re-verified on the new laptop on 2026-10-23. Every `[ ]` is a halt gate: `super-board run` refuses to start until each one is `[✓]`. Key names only; values go in `.env.local`, never here.

## 🔑 Credentials the loop will need

- [✓] Supabase local stack running (`supabase start`; Studio at http://127.0.0.1:54323) (verified; auth health 200)
- [✓] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` in `.env.local` (verified by name)
- [✓] Google OAuth client "SSF Gala local" created, with redirect URI `http://127.0.0.1:54321/auth/v1/callback`; ID and secret in gitignored `supabase/.env` for `config.toml` (#7 wires it) (verified by name; `/auth/v1/authorize?provider=google` redirects to Google with that callback)
- [✓] `E2E_AUTH=1` in `.env.local` for the test sign-in route (verified by name)
- [✓] `STRIPE_SECRET_KEY` (sandbox, `sk_test_…`) and `STRIPE_WEBHOOK_SECRET` from `stripe listen` in `.env.local` (verified by name). `stripe listen` secrets are per device: compare with `stripe listen --print-secret` after a laptop change
- [✓] `RESEND_API_KEY` and `EMAIL_FROM` (Resend test sender for now) in `.env.local` (verified by name). Verify the foundation's domain in Resend before tickets go on sale
- [✓] `SENTRY_DSN` and `SENTRY_AUTH_TOKEN` for Sentry project `small-steps-foundation/ssf-gala` in `.env.local` (verified by name; super-collect ping ok)
- [✓] Railway project `ssf-gala-dev` linked, with `staging` (staging branch) and `production` (main) environments; CLI defaults to `staging` (verified; no service linked yet)

## 🛠 Tools the loop will need

- [✓] `gh` authenticated as akhil-aggrawal with `project`, `repo` and `workflow` scopes (verified)
- [✓] Node 24 and npm 11 (verified: Node 24.22.1, npm 11.19.1 via nvm; Homebrew builds Node from source on this Intel Mac, so use nvm)
- [✓] Docker Desktop 29.9.2 running (verified; Supabase local needs it; `~/.docker/bin` is on PATH via `~/.zprofile`)
- [✓] Supabase CLI 2.122.0 (verified)
- [✓] Stripe CLI 1.55.1, logged in to Small Steps Foundation with `livemode: false` (verified; never use `--live`)
- [✓] Railway CLI 5.71.0, logged in (verified)
- [✓] Playwright 1.64.1 Chromium installed in `~/Library/Caches/ms-playwright`; headless launch verified. #1 adds `@playwright/test` to the project; if it pins another version, run `npx playwright install chromium`

## 🌐 Environment

- [✓] `.env.local` has every key above: Supabase, Stripe, Resend, Sentry (verified by name)
- [✓] Local checkout on `staging` with a clean working tree (verified after ae90691; `super-board run` re-checks it at start)
