-- Issue #6 QA: row-level security edge cases (cross-user reads, admin writes,
-- draft events). Companion to row_level_security_test.sql.
-- Run with: supabase test db
begin;
select plan(20);

-- People: one admin, two sponsors, two guests.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000701', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000702', 'sponsor1@example.com'),
  ('00000000-0000-0000-0000-000000000703', 'sponsor2@example.com'),
  ('00000000-0000-0000-0000-000000000704', 'guest1@example.com'),
  ('00000000-0000-0000-0000-000000000705', 'guest2@example.com');

insert into public.profiles (id, email) select id, email from auth.users
  where id::text like '00000000-0000-0000-0000-00000000070_';

insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-000000000701', 'admin'),
  ('00000000-0000-0000-0000-000000000702', 'sponsor'),
  ('00000000-0000-0000-0000-000000000703', 'sponsor'),
  ('00000000-0000-0000-0000-000000000704', 'attendee'),
  ('00000000-0000-0000-0000-000000000705', 'attendee');

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000710', 'Gala 2027', 2027, 'open');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000710', 'Gold', 20000, 20000);

insert into public.sponsors (id, event_id, user_id, display_name, email) values
  ('00000000-0000-0000-0000-000000000721', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000702', 'Acme', 'sponsor1@example.com'),
  ('00000000-0000-0000-0000-000000000722', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000703', 'Globex', 'sponsor2@example.com');

insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-000000000731', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000721', 200000),
  ('00000000-0000-0000-0000-000000000732', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000722', 200000);

insert into public.sponsored_tables (id, event_id, sponsorship_id, tier_id, invite_token_hash) values
  ('00000000-0000-0000-0000-000000000741', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000731', '00000000-0000-0000-0000-000000000711', 'hash-edge-1'),
  ('00000000-0000-0000-0000-000000000742', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000732', '00000000-0000-0000-0000-000000000711', 'hash-edge-2');

-- Guest 1 at sponsor 1's table, guest 2 at sponsor 2's table, and guest 2
-- also buys an individual ticket.
insert into public.registrations (id, event_id, created_by, kind, tier_id, sponsored_table_id) values
  ('00000000-0000-0000-0000-000000000751', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000704', 'sponsored',
   '00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000741'),
  ('00000000-0000-0000-0000-000000000752', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000705', 'sponsored',
   '00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000742'),
  ('00000000-0000-0000-0000-000000000753', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000705', 'individual',
   '00000000-0000-0000-0000-000000000711', null);

insert into public.attendees (id, event_id, registration_id, full_name, email) values
  ('00000000-0000-0000-0000-000000000761', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000751', 'Table One Guest', 'one@example.com'),
  ('00000000-0000-0000-0000-000000000762', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000752', 'Table Two Guest', 'two@example.com'),
  ('00000000-0000-0000-0000-000000000763', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000753', 'Ticket Guest', 'ticket@example.com');

-- Guest 2's ticket is paid and allocated to its attendee.
insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status) values
  ('00000000-0000-0000-0000-000000000771', '00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000753', 'stripe', 'ticket', 20000, 'succeeded');

insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents) values
  ('00000000-0000-0000-0000-000000000710', '00000000-0000-0000-0000-000000000771',
   '00000000-0000-0000-0000-000000000763', 20000);

insert into public.audit_logs (event_id, actor_id, action, entity_type) values
  ('00000000-0000-0000-0000-000000000710',
   '00000000-0000-0000-0000-000000000701', 'update', 'sponsors');

-- Sponsor 1: nothing of sponsor 2 is visible, at any level of the chain.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000702","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.sponsorships $$,
  array['00000000-0000-0000-0000-000000000731'::uuid],
  'a sponsor sees only their own sponsorships'
);
select results_eq(
  $$ select invite_token_hash from public.sponsored_tables $$,
  array['hash-edge-1'],
  'a sponsor cannot read another sponsor''s table or invite token hash'
);
select results_eq(
  $$ select id from public.registrations $$,
  array['00000000-0000-0000-0000-000000000751'::uuid],
  'a sponsor sees only the registrations on their own table'
);
select results_eq(
  $$ select attendee_id from public.attendee_payment_status $$,
  array['00000000-0000-0000-0000-000000000761'::uuid],
  'attendee_payment_status shows a sponsor only their own table''s attendees'
);
select is_empty(
  $$ select 1 from public.payment_allocations $$,
  'a sponsor cannot see payment allocations'
);
select is_empty(
  $$ select 1 from public.audit_logs $$,
  'a sponsor cannot read the audit log'
);
select results_eq(
  $$ select id from public.profiles $$,
  array['00000000-0000-0000-0000-000000000702'::uuid],
  'a sponsor sees only their own profile, not their guests'' or others'''
);

-- Guest 1: no access to guest 2's registrations, payment or profile.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000704","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.registrations $$,
  array['00000000-0000-0000-0000-000000000751'::uuid],
  'a guest sees only the registrations they made'
);
select is_empty(
  $$ select 1 from public.payments $$,
  'a guest cannot see another guest''s payment'
);
select is_empty(
  $$ select 1 from public.payment_allocations $$,
  'a guest cannot see another guest''s payment allocation'
);
select results_eq(
  $$ select id from public.profiles $$,
  array['00000000-0000-0000-0000-000000000704'::uuid],
  'a guest sees only their own profile'
);

-- Guest 2 sees the allocation for the payment they made.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000705","role":"authenticated"}', true);

select results_eq(
  $$ select attendee_id from public.payment_allocations $$,
  array['00000000-0000-0000-0000-000000000763'::uuid],
  'a guest sees the allocation of their own payment'
);

-- Admin: reads the audit log, but cannot write money or role rows either.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.audit_logs
   where event_id = '00000000-0000-0000-0000-000000000710'),
  1,
  'an admin reads the audit log'
);
select throws_ok(
  $$ insert into public.payments (event_id, registration_id, provider, purpose, amount_cents, status)
     values ('00000000-0000-0000-0000-000000000710', '00000000-0000-0000-0000-000000000751',
             'manual', 'ticket', 20000, 'succeeded') $$,
  '42501', null,
  'an admin session cannot insert into payments from the client'
);
select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-0000-0000-000000000704', 'admin') $$,
  '42501', null,
  'an admin session cannot grant roles from the client'
);
select throws_ok(
  $$ update public.payments set amount_cents = 1
     where id = '00000000-0000-0000-0000-000000000771' $$,
  '42501', null,
  'an admin session cannot update a payment from the client'
);

-- Draft events and their tiers are hidden from everyone but admins.
reset role;
update public.events set status = 'draft'
  where id = '00000000-0000-0000-0000-000000000710';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000704","role":"authenticated"}', true);

select is_empty(
  $$ select 1 from public.events where id = '00000000-0000-0000-0000-000000000710' $$,
  'a guest cannot see a draft event'
);
select is_empty(
  $$ select 1 from public.seating_tiers where event_id = '00000000-0000-0000-0000-000000000710' $$,
  'a guest cannot see a draft event''s tiers'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000701","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.events where id = '00000000-0000-0000-0000-000000000710'),
  1,
  'an admin sees the draft event'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is_empty(
  $$ select 1 from public.events $$,
  'anon reads no events'
);

select * from finish();
rollback;
