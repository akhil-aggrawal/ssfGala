-- Issue #14: apply_stripe_checkout_event, the Stripe webhook's one write.
-- Run with: supabase test db
begin;
select plan(26);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000001401', 'Gala webhook test', 2914, 'closed');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000014a1', '00000000-0000-0000-0000-000000001401', 'Gold', 20000, 20000);

-- r1: paid in full · r2: paid a different amount · r3: expired · r4: async failed
insert into public.registrations (id, event_id, kind, tier_id, status) values
  ('00000000-0000-0000-0000-0000000014e1', '00000000-0000-0000-0000-000000001401', 'individual',
   '00000000-0000-0000-0000-0000000014a1', 'pending_payment'),
  ('00000000-0000-0000-0000-0000000014e2', '00000000-0000-0000-0000-000000001401', 'individual',
   '00000000-0000-0000-0000-0000000014a1', 'pending_payment'),
  ('00000000-0000-0000-0000-0000000014e3', '00000000-0000-0000-0000-000000001401', 'individual',
   '00000000-0000-0000-0000-0000000014a1', 'pending_payment'),
  ('00000000-0000-0000-0000-0000000014e4', '00000000-0000-0000-0000-000000001401', 'individual',
   '00000000-0000-0000-0000-0000000014a1', 'pending_payment');

insert into public.attendees (id, event_id, registration_id, full_name, email, cancelled_at) values
  ('00000000-0000-0000-0000-0000000014f1', '00000000-0000-0000-0000-000000001401',
   '00000000-0000-0000-0000-0000000014e1', 'Guest One', 'one@example.com', null),
  ('00000000-0000-0000-0000-0000000014f2', '00000000-0000-0000-0000-000000001401',
   '00000000-0000-0000-0000-0000000014e1', 'Guest Two', 'two@example.com', null),
  ('00000000-0000-0000-0000-0000000014f3', '00000000-0000-0000-0000-000000001401',
   '00000000-0000-0000-0000-0000000014e1', 'Cancelled Guest', 'gone@example.com', now()),
  ('00000000-0000-0000-0000-0000000014f4', '00000000-0000-0000-0000-000000001401',
   '00000000-0000-0000-0000-0000000014e2', 'Guest Four', 'four@example.com', null);

insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status, stripe_session_id) values
  ('00000000-0000-0000-0000-000000001461', '00000000-0000-0000-0000-000000001401',
   '00000000-0000-0000-0000-0000000014e1', 'stripe', 'ticket', 40000, 'pending', 'cs_test_14_paid'),
  ('00000000-0000-0000-0000-000000001462', '00000000-0000-0000-0000-000000001401',
   '00000000-0000-0000-0000-0000000014e2', 'stripe', 'ticket', 20000, 'pending', 'cs_test_14_short'),
  ('00000000-0000-0000-0000-000000001463', '00000000-0000-0000-0000-000000001401',
   '00000000-0000-0000-0000-0000000014e3', 'stripe', 'ticket', 20000, 'pending', 'cs_test_14_expired'),
  ('00000000-0000-0000-0000-000000001464', '00000000-0000-0000-0000-000000001401',
   '00000000-0000-0000-0000-0000000014e4', 'stripe', 'ticket', 20000, 'pending', 'cs_test_14_async');

select has_function('public', 'apply_stripe_checkout_event',
  array['text', 'text', 'text', 'text', 'bigint', 'text'], 'apply_stripe_checkout_event exists');

-- Completed but not yet paid (delayed payment method): nothing confirmed yet.
select is(
  public.apply_stripe_checkout_event('evt_14_unpaid', 'checkout.session.completed', 'cs_test_14_paid', 'unpaid', 40000, null) ->> 'outcome',
  'awaiting_payment', 'completed + unpaid waits for the async event');
select is((select status from public.payments where stripe_session_id = 'cs_test_14_paid'),
  'pending', 'unpaid session leaves the payment pending');

-- AC2: completed + paid confirms once
select is(
  public.apply_stripe_checkout_event('evt_14_paid', 'checkout.session.completed', 'cs_test_14_paid', 'paid', 40000, 'pi_14_paid') ->> 'outcome',
  'confirmed', 'completed + paid confirms the payment');
select is((select status from public.payments where stripe_session_id = 'cs_test_14_paid'),
  'succeeded', 'payment marked succeeded');
select is((select stripe_payment_intent_id from public.payments where stripe_session_id = 'cs_test_14_paid'),
  'pi_14_paid', 'payment intent id stored');
select isnt((select received_at from public.payments where stripe_session_id = 'cs_test_14_paid'),
  null, 'received_at set');
select is((select status from public.registrations where id = '00000000-0000-0000-0000-0000000014e1'),
  'registered', 'registration set to registered');
select results_eq(
  $$ select attendee_id, amount_cents from public.payment_allocations
     where payment_id = '00000000-0000-0000-0000-000000001461' order by attendee_id $$,
  $$ values ('00000000-0000-0000-0000-0000000014f1'::uuid, 20000::bigint),
            ('00000000-0000-0000-0000-0000000014f2'::uuid, 20000::bigint) $$,
  'one allocation per live attendee, summing to the paid amount');

-- AC2: replay of the same event changes nothing
select is(
  public.apply_stripe_checkout_event('evt_14_paid', 'checkout.session.completed', 'cs_test_14_paid', 'paid', 40000, 'pi_14_paid') ->> 'outcome',
  'duplicate', 'replayed event id is a duplicate');
select is((select count(*)::int from public.stripe_webhook_events where event_id = 'evt_14_paid'),
  1, 'event id recorded once');
select is((select count(*)::int from public.payments where stripe_session_id = 'cs_test_14_paid' and status = 'succeeded'),
  1, 'still one succeeded payment');
select is((select count(*)::int from public.payment_allocations where payment_id = '00000000-0000-0000-0000-000000001461'),
  2, 'no extra allocations after replay');

-- A second event for the same session (Stripe can send two) is not applied twice.
select is(
  public.apply_stripe_checkout_event('evt_14_paid_async', 'checkout.session.async_payment_succeeded', 'cs_test_14_paid', 'paid', 40000, 'pi_14_paid') ->> 'outcome',
  'already_settled', 'second event for a settled session is ignored');
select is((select count(*)::int from public.payment_allocations where payment_id = '00000000-0000-0000-0000-000000001461'),
  2, 'still two allocations');

-- AC3: paid amount differs from the stored amount
select is(
  public.apply_stripe_checkout_event('evt_14_short', 'checkout.session.completed', 'cs_test_14_short', 'paid', 15000, 'pi_14_short'),
  '{"outcome": "amount_mismatch", "expected_cents": 20000}'::jsonb, 'mismatch reported with the expected amount');
select is((select status from public.payments where stripe_session_id = 'cs_test_14_short'),
  'pending', 'mismatched payment not confirmed');
select is((select status from public.registrations where id = '00000000-0000-0000-0000-0000000014e2'),
  'pending_payment', 'mismatched registration stays pending_payment');
select is((select count(*)::int from public.payment_allocations where payment_id = '00000000-0000-0000-0000-000000001462'),
  0, 'no allocations on mismatch');

-- AC4: expired session
select is(
  public.apply_stripe_checkout_event('evt_14_expired', 'checkout.session.expired', 'cs_test_14_expired', 'unpaid', 20000, null) ->> 'outcome',
  'failed', 'expired session marks the payment failed');
select is((select status from public.registrations where id = '00000000-0000-0000-0000-0000000014e3'),
  'pending_payment', 'expired session leaves the registration pending_payment');

-- Async payment failed
select is(
  public.apply_stripe_checkout_event('evt_14_async_failed', 'checkout.session.async_payment_failed', 'cs_test_14_async', 'unpaid', 20000, 'pi_14_async') ->> 'outcome',
  'failed', 'async failure marks the payment failed');
select is((select status from public.registrations where id = '00000000-0000-0000-0000-0000000014e4'),
  'pending_payment', 'async failure leaves the registration pending_payment');

-- A session this app never stored
select is(
  public.apply_stripe_checkout_event('evt_14_unknown', 'checkout.session.completed', 'cs_test_14_nobody', 'paid', 100, null) ->> 'outcome',
  'unknown_session', 'unknown session is reported, nothing changes');

-- Only the server (service role) may call it; browsers never can.
select ok(not has_function_privilege('anon', 'public.apply_stripe_checkout_event(text, text, text, text, bigint, text)', 'execute'),
  'anon cannot execute');
select ok(not has_function_privilege('authenticated', 'public.apply_stripe_checkout_event(text, text, text, text, bigint, text)', 'execute'),
  'authenticated cannot execute');

select * from finish();
rollback;
