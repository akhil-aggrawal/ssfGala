-- QA edge cases for issue #2 (one active gala, tier price and name checks).
-- Run with: supabase test db
begin;
select plan(17);

-- One active gala: only draft/open count; closed and archived do not.
insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'Gala 2024', 2024, 'archived'),
  ('00000000-0000-0000-0000-0000000000a2', 'Gala 2025', 2025, 'closed');

select lives_ok(
  $$ insert into public.events (id, name, year, status)
     values ('00000000-0000-0000-0000-0000000000a3', 'Gala 2026', 2026, 'open') $$,
  'an open event is accepted while the others are closed or archived'
);

select throws_ok(
  $$ insert into public.events (name, year, status) values ('Gala 2027', 2027, 'draft') $$,
  '23505', null,
  'a new draft event fails while one is open'
);

select throws_ok(
  $$ update public.events set status = 'open'
     where id = '00000000-0000-0000-0000-0000000000a2' $$,
  '23505', null,
  'reopening a closed event fails while another is open'
);

update public.events set status = 'closed'
where id = '00000000-0000-0000-0000-0000000000a3';

select lives_ok(
  $$ insert into public.events (name, year, status) values ('Gala 2027', 2027, 'draft') $$,
  'a new draft event is accepted once the open one is closed'
);

-- Tier prices: every price column rejects negatives; zero is allowed.
select throws_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents)
     values ('00000000-0000-0000-0000-0000000000a3', 'Gold', 20000, -1) $$,
  '23514', null,
  'a negative suggested contribution is rejected'
);

select throws_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents, sponsorship_amount_cents)
     values ('00000000-0000-0000-0000-0000000000a3', 'Gold', 20000, 20000, -1) $$,
  '23514', null,
  'a negative sponsorship amount is rejected'
);

select throws_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents, table_inventory)
     values ('00000000-0000-0000-0000-0000000000a3', 'Gold', 20000, 20000, -1) $$,
  '23514', null,
  'a negative table inventory is rejected'
);

select lives_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents, sponsorship_amount_cents)
     values ('00000000-0000-0000-0000-0000000000a3', 'Gold', 0, 0, 0) $$,
  'a zero price is accepted'
);

-- Tier names: exact Silver, Gold or Platinum only.
select throws_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents)
     values ('00000000-0000-0000-0000-0000000000a3', 'platinum', 25000, 25000) $$,
  '23514', null,
  'a lowercase tier name is rejected'
);

select throws_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents)
     values ('00000000-0000-0000-0000-0000000000a3', null, 25000, 25000) $$,
  '23502', null,
  'a null tier name is rejected'
);

select lives_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents)
     values ('00000000-0000-0000-0000-0000000000a3', 'Platinum', 25000, 25000) $$,
  'a valid Platinum tier is accepted'
);

select throws_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents)
     values ('00000000-0000-0000-0000-0000000000a3', 'Gold', 20000, 20000) $$,
  '23505', null,
  'a second Gold tier on the same event is rejected'
);

select throws_ok(
  $$ update public.seating_tiers set seat_price_cents = -100
     where event_id = '00000000-0000-0000-0000-0000000000a3' and name = 'Platinum' $$,
  '23514', null,
  'updating a tier to a negative price is rejected'
);

-- Roles: only admin, sponsor, attendee.
select throws_ok(
  $$ insert into public.user_roles (user_id, role)
     values ('00000000-0000-0000-0000-0000000000f1', 'superuser') $$,
  '23514', null,
  'a role other than admin, sponsor or attendee is rejected'
);

-- RLS is on for all four tables, and with no policies anon reads nothing.
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relrowsecurity
     and c.relname in ('events', 'profiles', 'user_roles', 'seating_tiers')),
  4,
  'row level security is enabled on all four tables'
);

set local role anon;
select is_empty(
  $$ select 1 from public.events $$,
  'anon sees no events'
);
select is_empty(
  $$ select 1 from public.seating_tiers $$,
  'anon sees no seating tiers'
);
reset role;

select * from finish();
rollback;
