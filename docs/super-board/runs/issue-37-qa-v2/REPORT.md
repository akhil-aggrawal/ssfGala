# QA v2 · issue #37 · head 6eb3020

Rebuild pass after reviewer round 1 (R1 blocker, R2 gap). Docs only, no UI, no screenshots.

| Check | Result | Proof |
|---|---|---|
| AC1 each step has exact screen or command | pass | unchanged from v1; routes and labels still match the code |
| AC2 every Stripe session is succeeded, failed or expired | pass | step 4 query and the resend table now match the webhook |
| AC3 next year starts with nothing copied | pass | unchanged from v1 |
| R1 failed delivery is a 4xx or 5xx and resend is processed | pass | `webhook.ts` returns 500 on a thrown apply, and `apply_stripe_checkout_event.sql:47-48` rolls back the event insert with the transaction |
| R1 2xx resend is a no-op | pass | `apply_stripe_checkout_event.sql:47-51` returns `duplicate` for a known event id |
| R1 mismatch returns 200, log text is `paid amount does not match the order` | pass | `webhook.ts:78-84` logs that text and falls through to 200; `unknown_session` logs `no stored payment for this session` |
| R2 late-payment query | pass | `payments.received_at` set only on `succeeded` (`...apply_stripe_checkout_event.sql:83-85`); columns `provider/status/stripe_session_id/amount_cents/received_at` exist; `refunded` is a valid status (`...payments_allocations_audit.sql:18`); `events.status` closed exists; admin export of a closed gala unavailable (`roles.ts:26`) |

Local tests: reading the runbook against `webhook.ts`, the apply function migration and the payments migration at `6eb3020`
