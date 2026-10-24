-- Issue #6: row-level security for admins, sponsors and guests.
-- Run with: supabase test db
begin;
select plan(20);

-- People: one admin, two sponsors, two guests.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000601', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000602', 'sponsor1@example.com'),
  ('00000000-0000-0000-0000-000000000603', 'sponsor2@example.com'),
  ('00000000-0000-0000-0000-000000000604', 'guest1@example.com'),
  ('00000000-0000-0000-0000-000000000605', 'guest2@example.com');

insert into public.profiles (id, email) select id, email from auth.users
  where id::text like '00000000-0000-0000-0000-00000000060_';

insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-000000000601', 'admin'),
  ('00000000-0000-0000-0000-000000000602', 'sponsor'),
  ('00000000-0000-0000-0000-000000000603', 'sponsor'),
  ('00000000-0000-0000-0000-000000000604', 'attendee'),
  ('00000000-0000-0000-0000-000000000605', 'attendee');

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000610', 'Gala 2027', 2027, 'open');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000610', 'Gold', 20000, 20000);

-- Sponsor 1 and sponsor 2 each pledge one table.
insert into public.sponsors (id, event_id, user_id, display_name, email) values
  ('00000000-0000-0000-0000-000000000621', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000602', 'Acme', 'sponsor1@example.com'),
  ('00000000-0000-0000-0000-000000000622', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000603', 'Globex', 'sponsor2@example.com');

insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-000000000631', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000621', 200000),
  ('00000000-0000-0000-0000-000000000632', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000622', 200000);

insert into public.sponsored_tables (id, event_id, sponsorship_id, tier_id, invite_token_hash) values
  ('00000000-0000-0000-0000-000000000641', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000631', '00000000-0000-0000-0000-000000000611', 'hash-rls-1'),
  ('00000000-0000-0000-0000-000000000642', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000632', '00000000-0000-0000-0000-000000000611', 'hash-rls-2');

-- Guest 1 registers at sponsor 1's table, guest 2 at sponsor 2's table,
-- and guest 1 also buys an individual ticket.
insert into public.registrations (id, event_id, created_by, kind, tier_id, sponsored_table_id) values
  ('00000000-0000-0000-0000-000000000651', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000604', 'sponsored',
   '00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000641'),
  ('00000000-0000-0000-0000-000000000652', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000605', 'sponsored',
   '00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000642'),
  ('00000000-0000-0000-0000-000000000653', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000604', 'individual',
   '00000000-0000-0000-0000-000000000611', null);

insert into public.attendees (id, event_id, registration_id, full_name, email) values
  ('00000000-0000-0000-0000-000000000661', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000651', 'Table One Guest', 'one@example.com'),
  ('00000000-0000-0000-0000-000000000662', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000652', 'Table Two Guest', 'two@example.com'),
  ('00000000-0000-0000-0000-000000000663', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000653', 'Ticket Guest', 'ticket@example.com');

insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status) values
  ('00000000-0000-0000-0000-000000000671', '00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000653', 'stripe', 'ticket', 20000, 'succeeded');

insert into public.stripe_webhook_events (event_id) values ('evt_rls_test');

-- AC4: every public table has RLS enabled.
select ok(
  (select count(*) from pg_tables where schemaname = 'public') >= 13,
  'the public schema holds the gala tables'
);
select is(
  (select array_agg(tablename::text order by tablename)
   from pg_tables where schemaname = 'public' and not rowsecurity),
  null,
  'every public table has row level security enabled'
);

-- AC1: sponsor 1 sees only their own table's attendees.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000602","role":"authenticated"}', true);

select results_eq(
  $$ select full_name from public.attendees order by full_name $$,
  array['Table One Guest'],
  'a sponsor selects only the attendees on their own table'
);
select is_empty(
  $$ select 1 from public.attendees where id = '00000000-0000-0000-0000-000000000662' $$,
  'a sponsor cannot select another sponsor''s attendee'
);
select results_eq(
  $$ select display_name from public.sponsors $$,
  array['Acme'],
  'a sponsor sees only their own sponsor row'
);
select is_empty(
  $$ select 1 from public.payments $$,
  'a sponsor cannot see their guests'' payments'
);
select results_eq(
  $$ select role from public.user_roles $$,
  array['sponsor'],
  'a sponsor sees only their own roles'
);

-- No client writes: an update the sponsor attempts changes nothing.
update public.attendees set full_name = 'Renamed'
  where id = '00000000-0000-0000-0000-000000000661';

-- AC2: authenticated inserts into payments and user_roles fail.
select throws_ok(
  $$ insert into public.payments (event_id, registration_id, provider, purpose, amount_cents, status)
     values ('00000000-0000-0000-0000-000000000610', '00000000-0000-0000-0000-000000000651',
             'stripe', 'ticket', 20000, 'succeeded') $$,
  '42501', null,
  'an authenticated client cannot insert into payments'
);
select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-0000-0000-000000000602', 'admin') $$,
  '42501', null,
  'an authenticated client cannot grant itself a role'
);
select throws_ok(
  $$ insert into public.attendees (event_id, registration_id, full_name, email)
     values ('00000000-0000-0000-0000-000000000610', '00000000-0000-0000-0000-000000000651',
             'Sneaky', 'sneaky@example.com') $$,
  '42501', null,
  'an authenticated client cannot insert attendees directly'
);

-- AC2: anon inserts into payments and user_roles fail; anon reads nothing.
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$ insert into public.payments (event_id, registration_id, provider, purpose, amount_cents, status)
     values ('00000000-0000-0000-0000-000000000610', '00000000-0000-0000-0000-000000000651',
             'stripe', 'ticket', 20000, 'succeeded') $$,
  '42501', null,
  'an anon client cannot insert into payments'
);
select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-0000-0000-000000000602', 'admin') $$,
  '42501', null,
  'an anon client cannot insert into user_roles'
);
select is_empty(
  $$ select 1 from public.attendees $$,
  'anon sees no attendees'
);

-- Guest 1 sees their own registrations, attendees and payment only.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000604","role":"authenticated"}', true);

select results_eq(
  $$ select full_name from public.attendees order by full_name $$,
  array['Table One Guest', 'Ticket Guest'],
  'a guest selects only the attendees of registrations they made'
);
select results_eq(
  $$ select id from public.payments $$,
  array['00000000-0000-0000-0000-000000000671'::uuid],
  'a guest sees the payment for their own registration'
);
select is_empty(
  $$ select 1 from public.sponsors $$,
  'a guest cannot see sponsor rows'
);

-- AC3: the admin sees every attendee of the active event.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000601","role":"authenticated"}', true);

select results_eq(
  $$ select a.full_name from public.attendees a
     join public.events e on e.id = a.event_id
     where e.id = '00000000-0000-0000-0000-000000000610' and e.status in ('draft', 'open')
     order by a.full_name $$,
  array['Table One Guest', 'Table Two Guest', 'Ticket Guest'],
  'an admin selects every attendee of the active event'
);
select is(
  (select count(*)::int from public.sponsors where event_id = '00000000-0000-0000-0000-000000000610'),
  2,
  'an admin sees every sponsor'
);
select is_empty(
  $$ select 1 from public.stripe_webhook_events $$,
  'no client session reads stripe_webhook_events'
);

reset role;
select is(
  (select full_name from public.attendees where id = '00000000-0000-0000-0000-000000000661'),
  'Table One Guest',
  'the sponsor''s client-side update changed nothing'
);

select * from finish();
rollback;
