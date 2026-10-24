# Issue #5 QA v1 — payments, allocations, webhook events, audit log

Tested head: `ffe5b61` (builder) + QA edge tests.

| AC | Result | Proof |
|---|---|---|
| AC1 duplicate `stripe_session_id` rejected | pass | `payments_allocations_test.sql` "a second payment with the same stripe_session_id is rejected"; edge: two offline payments with null session id both accepted |
| AC2 sponsorship payment with `registration_id` rejected | pass | `payments_allocations_test.sql` 23514 check |
| AC3 `paid = true` only with a succeeded allocation | pass | base: pending / none → false; edges: refunded → false, failed → false, refunded+succeeded → true, refund flips to false |
| AC4 types updated, `npm run verify` passes | pass | `npm run db:types` produces no diff; `npm-verify.log` 62/62 vitest, lint + typecheck clean |

`supabase test db`: 8 files, 103 tests, PASS (`supabase-test-db.log`).

Mutation check (never committed):
- view `p.status = 'succeeded'` -> `p.status <> 'pending'`: 3 edge tests red (`mutant-status-not-pending.log`)
- allocation FK `(attendee_id, event_id)` -> `(attendee_id)`: cross-event test red (`mutant-allocation-fk-no-event.log`)

Test gaps (not written):
- Medium: a `sponsorship`-purpose payment can be allocated to an attendee and marks them paid; no rule says whether that is allowed.
- Medium: `audit_logs` is not append-only at the DB level (no trigger blocking UPDATE/DELETE); relies on server code.
- Low: zero-cent payment (`amount_cents = 0`) accepted; boundary not pinned.

No UI in this change: screenshots omitted on purpose.
