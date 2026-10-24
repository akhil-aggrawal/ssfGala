-- Issue #14 QA edges: apply_stripe_checkout_event beyond the happy path.
-- Run with: supabase test db
begin;
select plan(16);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000001501', 'Gala webhook edges', 2915, 'closed');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000015a1', '00000000-0000-0000-0000-000000001501', 'Silver', 15000, 15000);

-- r1: uneven split · r2: delayed method · r3: paid then expired · r4: mismatch then replay
insert into public.registrations (id, event_id, kind, tier_id, status) values
  ('00000000-0000-0000-0000-0000000015e1', '00000000-0000-0000-0000-000000001501', 'individual',
   '00000000-0000-0000-0000-0000000015a1', 'pending_payment'),
  ('00000000-0000-0000-0000-0000000015e2', '00000000-0000-0000-0000-000000001501', 'individual',
   '00000000-0000-0000-0000-0000000015a1', 'pending_payment'),
  ('00000000-0000-0000-0000-0000000015e3', '00000000-0000-0000-0000-000000001501', 'individual',
   '00000000-0000-0000-0000-0000000015a1', 'pending_payment'),
  ('00000000-0000-0000-0000-0000000015e4', '00000000-0000-0000-0000-000000001501', 'individual',
   '00000000-0000-0000-0000-0000000015a1', 'pending_payment');

insert into public.attendees (id, event_id, registration_id, full_name, email, created_at) values
  ('00000000-0000-0000-0000-0000000015f1', '00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-0000000015e1', 'Split One', 'split1@example.com', '2026-01-01 00:00:01+00'),
  ('00000000-0000-0000-0000-0000000015f2', '00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-0000000015e1', 'Split Two', 'split2@example.com', '2026-01-01 00:00:02+00'),
  ('00000000-0000-0000-0000-0000000015f3', '00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-0000000015e1', 'Split Three', 'split3@example.com', '2026-01-01 00:00:03+00'),
  ('00000000-0000-0000-0000-0000000015f4', '00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-0000000015e2', 'Delayed', 'delayed@example.com', now()),
  ('00000000-0000-0000-0000-0000000015f5', '00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-0000000015e3', 'Late Expiry', 'late@example.com', now());

insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status, stripe_session_id) values
  ('00000000-0000-0000-0000-000000001561', '00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-0000000015e1', 'stripe', 'ticket', 45001, 'pending', 'cs_qa_15_split'),
  ('00000000-0000-0000-0000-000000001562', '00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-0000000015e2', 'stripe', 'ticket', 15000, 'pending', 'cs_qa_15_delayed'),
  ('00000000-0000-0000-0000-000000001563', '00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-0000000015e3', 'stripe', 'ticket', 15000, 'pending', 'cs_qa_15_late'),
  ('00000000-0000-0000-0000-000000001564', '00000000-0000-0000-0000-000000001501',
   '00000000-0000-0000-0000-0000000015e4', 'stripe', 'ticket', 15000, 'pending', 'cs_qa_15_short');

-- Uneven amount: 45001 over 3 attendees gives 15001, 15000, 15000, first attendee takes the extra cent.
select is(
  public.apply_stripe_checkout_event('evt_15_split', 'checkout.session.completed', 'cs_qa_15_split', 'paid', 45001, 'pi_15_split') ->> 'outcome',
  'confirmed', 'uneven amount confirms');
select results_eq(
  $$ select attendee_id, amount_cents from public.payment_allocations
     where payment_id = '00000000-0000-0000-0000-000000001561' order by attendee_id $$,
  $$ values ('00000000-0000-0000-0000-0000000015f1'::uuid, 15001::bigint),
            ('00000000-0000-0000-0000-0000000015f2'::uuid, 15000::bigint),
            ('00000000-0000-0000-0000-0000000015f3'::uuid, 15000::bigint) $$,
  'remainder cent goes to the first attendee');
select is((select sum(amount_cents)::bigint from public.payment_allocations
           where payment_id = '00000000-0000-0000-0000-000000001561'),
  45001::bigint, 'allocations sum to the paid amount');

-- Delayed method: completed + unpaid waits, then async_payment_succeeded confirms once.
select is(
  public.apply_stripe_checkout_event('evt_15_delayed_c', 'checkout.session.completed', 'cs_qa_15_delayed', 'unpaid', 15000, null) ->> 'outcome',
  'awaiting_payment', 'delayed method waits');
select is((select status from public.registrations where id = '00000000-0000-0000-0000-0000000015e2'),
  'pending_payment', 'registration still pending_payment while waiting');
select is(
  public.apply_stripe_checkout_event('evt_15_delayed_s', 'checkout.session.async_payment_succeeded', 'cs_qa_15_delayed', 'paid', 15000, 'pi_15_delayed') ->> 'outcome',
  'confirmed', 'async_payment_succeeded confirms');
select is((select status from public.payments where stripe_session_id = 'cs_qa_15_delayed'),
  'succeeded', 'delayed payment succeeded');
select is((select status from public.registrations where id = '00000000-0000-0000-0000-0000000015e2'),
  'registered', 'delayed registration registered');

-- Paid, then a late expired event: a confirmed order is never undone.
select is(
  public.apply_stripe_checkout_event('evt_15_late_paid', 'checkout.session.completed', 'cs_qa_15_late', 'paid', 15000, 'pi_15_late') ->> 'outcome',
  'confirmed', 'paid first');
select is(
  public.apply_stripe_checkout_event('evt_15_late_exp', 'checkout.session.expired', 'cs_qa_15_late', 'unpaid', 15000, null) ->> 'outcome',
  'already_settled', 'late expiry is ignored');
select is((select status from public.payments where stripe_session_id = 'cs_qa_15_late'),
  'succeeded', 'payment stays succeeded after a late expiry');
select is((select status from public.registrations where id = '00000000-0000-0000-0000-0000000015e3'),
  'registered', 'registration stays registered after a late expiry');

-- Mismatch, then Stripe replays the same event: still not confirmed.
select is(
  public.apply_stripe_checkout_event('evt_15_short', 'checkout.session.completed', 'cs_qa_15_short', 'paid', 1, 'pi_15_short') ->> 'outcome',
  'amount_mismatch', 'mismatch reported');
select is(
  public.apply_stripe_checkout_event('evt_15_short', 'checkout.session.completed', 'cs_qa_15_short', 'paid', 1, 'pi_15_short') ->> 'outcome',
  'duplicate', 'replayed mismatch is a duplicate');
select is((select status from public.payments where stripe_session_id = 'cs_qa_15_short'),
  'pending', 'mismatched payment still pending after replay');
select is((select status from public.registrations where id = '00000000-0000-0000-0000-0000000015e4'),
  'pending_payment', 'mismatched registration still pending_payment after replay');

select * from finish();
rollback;
