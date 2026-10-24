-- QA edge cases for issue #3 (sponsors, sponsorships, sponsored tables).
-- Run with: supabase test db
begin;
select plan(17);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000011', 'Gala 2027', 2027, 'open'),
  ('00000000-0000-0000-0000-000000000012', 'Gala 2026', 2026, 'archived');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000011', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-000000000012', 'Gold', 20000, 20000);

insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-000000000011', 'Acme', 'acme@example.com'),
  ('00000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-000000000012', 'Old Co', 'old@example.com');

insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-0000000001c1', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000001b1', 200000),
  ('00000000-0000-0000-0000-0000000001c2', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000001b2', 200000);

-- Event scope: a table's sponsorship must be in the table's event.
select throws_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash)
     values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000001c2',
             '00000000-0000-0000-0000-0000000001a1', 'edge-x') $$,
  '23503', null,
  'a sponsored table cannot reference a sponsorship from another event'
);

-- Event scope: tier and sponsorship both in event 2, table claims event 1.
select throws_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash)
     values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000001c2',
             '00000000-0000-0000-0000-0000000001a2', 'edge-y') $$,
  '23503', null,
  'a sponsored table cannot claim an event its tier and sponsorship are not in'
);

-- AC1: invite_token_hash is unique across events, not only within one.
insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash) values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000001c1',
   '00000000-0000-0000-0000-0000000001a1', 'edge-dup');

select throws_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash)
     values ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-0000000001c2',
             '00000000-0000-0000-0000-0000000001a2', 'edge-dup') $$,
  '23505', null,
  'the same invite_token_hash is rejected in a different event'
);

select throws_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash)
     values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000001c1',
             '00000000-0000-0000-0000-0000000001a1', null) $$,
  '23502', null,
  'a sponsored table without an invite_token_hash is rejected'
);

-- AC3: capacity boundaries (limit-1, limit, null).
select lives_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash, capacity)
     values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000001c1',
             '00000000-0000-0000-0000-0000000001a1', 'edge-cap1', 1) $$,
  'capacity 1 is accepted'
);

select throws_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash, capacity)
     values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000001c1',
             '00000000-0000-0000-0000-0000000001a1', 'edge-capneg', -1) $$,
  '23514', null,
  'a negative capacity is rejected'
);

select throws_ok(
  $$ insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash, capacity)
     values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000001c1',
             '00000000-0000-0000-0000-0000000001a1', 'edge-capnull', null) $$,
  '23502', null,
  'an explicit null capacity is rejected'
);

select throws_ok(
  $$ update public.sponsored_tables set capacity = 0 where invite_token_hash = 'edge-dup' $$,
  '23514', null,
  'updating capacity to 0 is rejected'
);

-- Money: zero pledge is allowed, status defaults to committed.
select lives_ok(
  $$ insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents)
     values ('00000000-0000-0000-0000-0000000001c3', '00000000-0000-0000-0000-000000000011',
             '00000000-0000-0000-0000-0000000001b1', 0) $$,
  'a zero pledge is accepted'
);

select is(
  (select status from public.sponsorships where id = '00000000-0000-0000-0000-0000000001c3'),
  'committed',
  'sponsorship status defaults to committed'
);

-- A sponsor's user_id must be a real profile.
select throws_ok(
  $$ insert into public.sponsors (event_id, user_id, display_name, email)
     values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-00000000dead',
             'Ghost', 'ghost@example.com') $$,
  '23503', null,
  'a sponsor cannot reference a missing profile'
);

-- RLS on (defense in depth) for every new table.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.sponsors'::regclass),
  'RLS is enabled on sponsors'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.sponsorships'::regclass),
  'RLS is enabled on sponsorships'
);

-- Indexes the schema doc lists.
select has_index('public', 'sponsors', 'sponsors_event_id_user_id_idx',
  array['event_id', 'user_id'], 'sponsors has an (event_id, user_id) index');

select has_index('public', 'sponsorships', 'sponsorships_event_id_sponsor_id_idx',
  array['event_id', 'sponsor_id'], 'sponsorships has an (event_id, sponsor_id) index');

select has_index('public', 'sponsored_tables', 'sponsored_tables_event_id_sponsorship_id_idx',
  array['event_id', 'sponsorship_id'], 'sponsored_tables has an (event_id, sponsorship_id) index');

select col_default_is('public', 'sponsored_tables', 'capacity', '10',
  'capacity column default is 10');

select * from finish();
rollback;
