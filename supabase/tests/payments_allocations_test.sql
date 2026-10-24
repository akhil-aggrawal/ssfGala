-- Issue #5: payments, payment_allocations, stripe_webhook_events, audit_logs.
-- Run with: supabase test db
begin;
select plan(16);

select has_table('public', 'payments', 'payments table exists');
select has_table('public', 'payment_allocations', 'payment_allocations table exists');
select has_table('public', 'stripe_webhook_events', 'stripe_webhook_events table exists');
select has_table('public', 'audit_logs', 'audit_logs table exists');

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000051', 'Gala 2027', 2027, 'open');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000051', 'Gold', 20000, 20000);

insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-000000000051', 'Acme', 'acme@example.com');

insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-000000000051',
   '00000000-0000-0000-0000-0000000005b1', 200000);

insert into public.registrations (id, event_id, kind, tier_id, status) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-000000000051', 'individual',
   '00000000-0000-0000-0000-0000000005a1', 'pending_payment');

insert into public.attendees (id, event_id, registration_id, full_name, email) values
  ('00000000-0000-0000-0000-0000000005f1', '00000000-0000-0000-0000-000000000051',
   '00000000-0000-0000-0000-0000000005e1', 'Paid Guest', 'paid@example.com'),
  ('00000000-0000-0000-0000-0000000005f2', '00000000-0000-0000-0000-000000000051',
   '00000000-0000-0000-0000-0000000005e1', 'Pending Guest', 'pending@example.com'),
  ('00000000-0000-0000-0000-0000000005f3', '00000000-0000-0000-0000-000000000051',
   '00000000-0000-0000-0000-0000000005e1', 'No Allocation', 'none@example.com');

-- AC1: stripe_session_id is unique
select lives_ok(
  $$ insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status, stripe_session_id)
     values ('00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000051',
             '00000000-0000-0000-0000-0000000005e1', 'stripe', 'ticket', 20000, 'succeeded', 'cs_test_1') $$,
  'a stripe ticket payment is accepted'
);

select throws_ok(
  $$ insert into public.payments (event_id, registration_id, provider, purpose, amount_cents, status, stripe_session_id)
     values ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000005e1',
             'stripe', 'ticket', 20000, 'pending', 'cs_test_1') $$,
  '23505', null,
  'a second payment with the same stripe_session_id is rejected'
);

-- AC2: a sponsorship payment carries a sponsorship and no registration
select throws_ok(
  $$ insert into public.payments (event_id, registration_id, sponsorship_id, provider, purpose, amount_cents, status)
     values ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000005e1',
             '00000000-0000-0000-0000-0000000005c1', 'offline', 'sponsorship', 50000, 'succeeded') $$,
  '23514', null,
  'a sponsorship payment with a registration_id is rejected'
);

select lives_ok(
  $$ insert into public.payments (event_id, sponsorship_id, provider, purpose, amount_cents, status, received_at)
     values ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000005c1',
             'offline', 'sponsorship', 50000, 'succeeded', now()) $$,
  'an offline sponsorship receipt with only a sponsorship_id is accepted'
);

select throws_ok(
  $$ insert into public.payments (event_id, sponsorship_id, provider, purpose, amount_cents, status)
     values ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-0000000005c1',
             'stripe', 'ticket', 20000, 'pending') $$,
  '23514', null,
  'a ticket payment without a registration_id is rejected'
);

-- AC3: paid = true only with a succeeded allocation
insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status, stripe_session_id) values
  ('00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000051',
   '00000000-0000-0000-0000-0000000005e1', 'stripe', 'ticket', 20000, 'pending', 'cs_test_2');

insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents) values
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000561',
   '00000000-0000-0000-0000-0000000005f1', 20000),
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000562',
   '00000000-0000-0000-0000-0000000005f2', 20000);

select is(
  (select paid from public.attendee_payment_status where attendee_id = '00000000-0000-0000-0000-0000000005f1'),
  true,
  'an attendee with a succeeded allocation is paid'
);

select is(
  (select paid from public.attendee_payment_status where attendee_id = '00000000-0000-0000-0000-0000000005f2'),
  false,
  'an attendee whose only allocation is pending is not paid'
);

select is(
  (select paid from public.attendee_payment_status where attendee_id = '00000000-0000-0000-0000-0000000005f3'),
  false,
  'an attendee with no allocation is not paid'
);

select throws_ok(
  $$ insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents)
     values ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000561',
             '00000000-0000-0000-0000-0000000005f1', 100) $$,
  '23505', null,
  'one payment allocates to one attendee at most once'
);

-- Webhook dedupe by Stripe event id
insert into public.stripe_webhook_events (event_id) values ('evt_test_1');
select throws_ok(
  $$ insert into public.stripe_webhook_events (event_id) values ('evt_test_1') $$,
  '23505', null,
  'a Stripe event id is recorded once'
);

select lives_ok(
  $$ insert into public.audit_logs (event_id, action, entity_type, entity_id, before_data, after_data)
     values ('00000000-0000-0000-0000-000000000051', 'payment.recorded', 'payment',
             '00000000-0000-0000-0000-000000000561', null, '{"amount_cents": 20000}') $$,
  'an audit log row is accepted'
);

select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.payments'::regclass, 'public.payment_allocations'::regclass,
                  'public.stripe_webhook_events'::regclass, 'public.audit_logs'::regclass)),
  'RLS is enabled on all four tables'
);

select * from finish();
rollback;
