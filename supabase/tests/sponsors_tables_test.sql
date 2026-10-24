-- Run with: supabase test db
begin;
select plan(12);

select has_table('public', 'sponsors', 'sponsors table exists');
select has_table('public', 'sponsorships', 'sponsorships table exists');
select has_table('public', 'sponsored_tables', 'sponsored_tables table exists');

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000001', 'Gala 2027', 2027, 'open'),
  ('00000000-0000-0000-0000-000000000002', 'Gala 2026', 2026, 'archived');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000002', 'Gold', 20000, 20000);

insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'Acme', 'acme@example.com');

insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 200000);

-- AC1: unique invite_token_hash
select lives_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1',
             '00000000-0000-0000-0000-0000000000a1', 'hash-1') $$,
  'a sponsored table with a new invite_token_hash is accepted'
);

select throws_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1',
             '00000000-0000-0000-0000-0000000000a1', 'hash-1') $$,
  '23505', null,
  'a second sponsored table with the same invite_token_hash is rejected'
);

-- AC2: tier must belong to the same event
select throws_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1',
             '00000000-0000-0000-0000-0000000000a2', 'hash-2') $$,
  '23503', null,
  'a sponsored table cannot reference a tier from another event'
);

-- Sponsorship and sponsor must also stay in one event
select throws_ok(
  $$ insert into public.sponsorships (event_id, sponsor_id, pledged_cents)
     values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', 100) $$,
  '23503', null,
  'a sponsorship cannot reference a sponsor from another event'
);

-- AC3: capacity defaults to 10 and must be > 0
select is(
  (select capacity from public.sponsored_tables where invite_token_hash = 'hash-1'),
  10,
  'capacity defaults to 10'
);

select throws_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash, capacity)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1',
             '00000000-0000-0000-0000-0000000000a1', 'hash-3', 0) $$,
  '23514', null,
  'capacity 0 is rejected'
);

select throws_ok(
  $$ insert into public.sponsorships (event_id, sponsor_id, pledged_cents)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', -1) $$,
  '23514', null,
  'a negative pledge is rejected'
);

select throws_ok(
  $$ insert into public.sponsorships (event_id, sponsor_id, pledged_cents, status)
     values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 100, 'paid') $$,
  '23514', null,
  'a sponsorship status other than committed or cancelled is rejected'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.sponsored_tables'::regclass),
  'RLS is enabled on sponsored_tables'
);

select * from finish();
rollback;
