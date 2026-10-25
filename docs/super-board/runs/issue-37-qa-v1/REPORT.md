# QA v1 · issue #37 · head 4621be6

Docs-only change: `docs/runbook.md`, one README row. No UI, no screenshots.

| AC | Result | Proof |
|---|---|---|
| Each shutdown step has the exact screen or command | pass | Routes exist: `/admin/exports`, `/admin/reports`, `/admin/setup`, `/admin/audit`, `/admin/sponsors` (`src/app/admin/`); `/api/health`, `/api/stripe/webhook` (`src/app/api/`); button labels match `src/app/admin/exports/page.tsx:19,28`; "New gala" and "Archived galas" match `src/app/admin/setup/page.tsx:52,54`; Railway project `ssf-gala-dev` matches `docs/super-board/pre-flight.md:14` |
| Check every Stripe session is succeeded, failed or expired | pass | SQL uses real columns `payments.provider/status/stripe_session_id` (`20261023150000_payments_allocations_audit.sql:13,18,20`); statuses match the check constraint; expired maps to failed (`20261024190000_apply_stripe_checkout_event.sql:65-66`); `amount_mismatch` exists (`src/lib/stripe/webhook.ts:78`) |
| Next year's event starts with no sponsors or registrations copied | pass | Runbook step 7 lists "No sponsors, pledges or tables are copied" and "No registrations, attendees or payments are copied"; event statuses draft/open/closed/archived match the schema |
