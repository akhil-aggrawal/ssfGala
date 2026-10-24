-- Issue #55: audit_logs and payment history are append-only.
-- Run with: supabase test db
begin;
select plan(9);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000081', 'Gala 2028', 2028, 'open');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-000000000081', 'Gold', 20000, 20000);

insert into public.registrations (id, event_id, kind, tier_id, status) values
  ('00000000-0000-0000-0000-0000000008e1', '00000000-0000-0000-0000-000000000081', 'individual',
   '00000000-0000-0000-0000-0000000008a1', 'registered');

insert into public.attendees (id, event_id, registration_id, full_name, email) values
  ('00000000-0000-0000-0000-0000000008f1', '00000000-0000-0000-0000-000000000081',
   '00000000-0000-0000-0000-0000000008e1', 'Append Guest', 'append@example.com');

insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status, stripe_session_id) values
  ('00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-000000000081',
   '00000000-0000-0000-0000-0000000008e1', 'stripe', 'ticket', 20000, 'pending', 'cs_append_only');

insert into public.payment_allocations (id, event_id, payment_id, attendee_id, amount_cents) values
  ('00000000-0000-0000-0000-000000000891', '00000000-0000-0000-0000-000000000081',
   '00000000-0000-0000-0000-000000000881', '00000000-0000-0000-0000-0000000008f1', 20000);

insert into public.audit_logs (event_id, action, entity_type, entity_id) values
  ('00000000-0000-0000-0000-000000000081', 'test.append', 'payment', '00000000-0000-0000-0000-000000000881');

-- AC1: audit_logs rejects UPDATE and DELETE, even for the service role
set local role service_role;

select throws_ok(
  $$ update public.audit_logs set action = 'tampered' where action = 'test.append' $$,
  '23001', null,
  'service role cannot update audit_logs'
);

select throws_ok(
  $$ delete from public.audit_logs where action = 'test.append' $$,
  '23001', null,
  'service role cannot delete audit_logs'
);

reset role;

select throws_ok(
  $$ update public.audit_logs set action = 'tampered' where action = 'test.append' $$,
  '23001', null,
  'the owning role cannot update audit_logs'
);

select throws_ok(
  $$ truncate public.audit_logs $$,
  '23001', null,
  'audit_logs cannot be truncated'
);

-- AC2: payments and payment_allocations reject DELETE
select throws_ok(
  $$ delete from public.payment_allocations where id = '00000000-0000-0000-0000-000000000891' $$,
  '23001', null,
  'a payment allocation cannot be deleted'
);

select throws_ok(
  $$ delete from public.payments where id = '00000000-0000-0000-0000-000000000881' $$,
  '23001', null,
  'a payment cannot be deleted'
);

-- AC3: status changes stay allowed
select lives_ok(
  $$ update public.payments set status = 'succeeded' where id = '00000000-0000-0000-0000-000000000881' $$,
  'a payment status can still change'
);

select is(
  (select status from public.payments where id = '00000000-0000-0000-0000-000000000881'),
  'succeeded',
  'the status change was saved'
);

-- New history rows can still be appended
select lives_ok(
  $$ insert into public.audit_logs (event_id, action, entity_type)
     values ('00000000-0000-0000-0000-000000000081', 'test.second', 'payment') $$,
  'audit_logs still accepts new rows'
);

select * from finish();
rollback;
