-- QA edge cases for issue #5 (payments, payment_allocations, attendee_payment_status).
-- Run with: supabase test db
begin;
select plan(11);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000071', 'Gala 2027', 2027, 'open'),
  ('00000000-0000-0000-0000-000000000072', 'Gala 2026', 2026, 'archived');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-000000000071', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-000000000072', 'Gold', 20000, 20000);

insert into public.registrations (id, event_id, kind, tier_id, status) values
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-000000000071', 'individual',
   '00000000-0000-0000-0000-0000000007a1', 'registered'),
  ('00000000-0000-0000-0000-0000000007e2', '00000000-0000-0000-0000-000000000072', 'individual',
   '00000000-0000-0000-0000-0000000007a2', 'registered');

insert into public.attendees (id, event_id, registration_id, full_name, email) values
  ('00000000-0000-0000-0000-0000000007f1', '00000000-0000-0000-0000-000000000071',
   '00000000-0000-0000-0000-0000000007e1', 'Refunded Guest', 'refunded@example.com'),
  ('00000000-0000-0000-0000-0000000007f2', '00000000-0000-0000-0000-000000000071',
   '00000000-0000-0000-0000-0000000007e1', 'Failed Guest', 'failed@example.com'),
  ('00000000-0000-0000-0000-0000000007f3', '00000000-0000-0000-0000-000000000071',
   '00000000-0000-0000-0000-0000000007e1', 'Mixed Guest', 'mixed@example.com'),
  ('00000000-0000-0000-0000-0000000007f4', '00000000-0000-0000-0000-000000000072',
   '00000000-0000-0000-0000-0000000007e2', 'Other Event Guest', 'other@example.com');

insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status, stripe_session_id) values
  ('00000000-0000-0000-0000-000000000771', '00000000-0000-0000-0000-000000000071',
   '00000000-0000-0000-0000-0000000007e1', 'stripe', 'ticket', 20000, 'refunded', 'cs_edge_refunded'),
  ('00000000-0000-0000-0000-000000000772', '00000000-0000-0000-0000-000000000071',
   '00000000-0000-0000-0000-0000000007e1', 'stripe', 'ticket', 20000, 'failed', 'cs_edge_failed'),
  ('00000000-0000-0000-0000-000000000773', '00000000-0000-0000-0000-000000000071',
   '00000000-0000-0000-0000-0000000007e1', 'stripe', 'ticket', 20000, 'succeeded', 'cs_edge_ok');

insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents) values
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000771',
   '00000000-0000-0000-0000-0000000007f1', 20000),
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000772',
   '00000000-0000-0000-0000-0000000007f2', 20000),
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000771',
   '00000000-0000-0000-0000-0000000007f3', 10000),
  ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000773',
   '00000000-0000-0000-0000-0000000007f3', 10000);

-- AC3 edges: only 'succeeded' counts as paid
select is(
  (select paid from public.attendee_payment_status where attendee_id = '00000000-0000-0000-0000-0000000007f1'),
  false,
  'an attendee whose only allocation is refunded is not paid'
);

select is(
  (select paid from public.attendee_payment_status where attendee_id = '00000000-0000-0000-0000-0000000007f2'),
  false,
  'an attendee whose only allocation failed is not paid'
);

select is(
  (select paid from public.attendee_payment_status where attendee_id = '00000000-0000-0000-0000-0000000007f3'),
  true,
  'an attendee with one refunded and one succeeded allocation is paid'
);

-- A refund flips paid back to false (status change, never a delete)
update public.payments set status = 'refunded'
  where id = '00000000-0000-0000-0000-000000000773';
select is(
  (select paid from public.attendee_payment_status where attendee_id = '00000000-0000-0000-0000-0000000007f3'),
  false,
  'refunding the succeeded payment makes the attendee unpaid'
);

-- AC1 edge: offline payments carry no stripe_session_id; many are allowed
select lives_ok(
  $$ insert into public.payments (event_id, registration_id, provider, purpose, amount_cents, status)
     values ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000007e1',
             'offline', 'seat_contribution', 15000, 'succeeded'),
            ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000007e1',
             'offline', 'seat_contribution', 15000, 'succeeded') $$,
  'two offline payments with no stripe_session_id are both accepted'
);

-- Event scope: rows cannot cross events
select throws_ok(
  $$ insert into public.payments (event_id, registration_id, provider, purpose, amount_cents, status)
     values ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000007e2',
             'offline', 'ticket', 20000, 'succeeded') $$,
  '23503', null,
  'a payment cannot reference a registration from another event'
);

select throws_ok(
  $$ insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents)
     values ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000771',
             '00000000-0000-0000-0000-0000000007f4', 20000) $$,
  '23503', null,
  'an allocation cannot pair a payment with an attendee from another event'
);

-- Money boundaries
select throws_ok(
  $$ insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents)
     values ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000772',
             '00000000-0000-0000-0000-0000000007f1', 0) $$,
  '23514', null,
  'a zero-cent allocation is rejected'
);

select throws_ok(
  $$ insert into public.payments (event_id, registration_id, provider, purpose, amount_cents, status)
     values ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000007e1',
             'offline', 'ticket', -1, 'succeeded') $$,
  '23514', null,
  'a negative payment amount is rejected'
);

-- Payments are never deleted (append-only trigger, issue #55)
select throws_ok(
  $$ delete from public.payments where id = '00000000-0000-0000-0000-000000000771' $$,
  '23001', null,
  'a payment with allocations cannot be deleted'
);

select throws_ok(
  $$ insert into public.payments (event_id, registration_id, provider, purpose, amount_cents, status)
     values ('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000007e1',
             'stripe', 'ticket', 20000, 'paid') $$,
  '23514', null,
  'an unknown payment status is rejected'
);

select * from finish();
rollback;
