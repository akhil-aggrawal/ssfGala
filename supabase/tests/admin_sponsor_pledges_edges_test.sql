-- Run with: supabase test db
-- QA edges for issue #27: the admin pledge and admin guest paths refuse a
-- closed gala, blank sponsor details and a cancelled sponsorship's table, and
-- a refused call saves nothing and writes no audit row.
begin;
select plan(10);

update public.events set status = 'closed' where status in ('draft', 'open');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000127a1', 'admin27e@example.test');
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-0000000127a1', 'admin27e@example.test');

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-0000000127e1', 'Edges open gala', 9371, 'open'),
  ('00000000-0000-0000-0000-0000000127e2', 'Edges closed gala', 9372, 'closed');
insert into public.seating_tiers
  (id, event_id, name, seat_price_cents, suggested_contribution_cents, sponsorship_amount_cents, table_inventory)
values
  ('00000000-0000-0000-0000-0000000127c1', '00000000-0000-0000-0000-0000000127e1', 'Gold', 20000, 20000, null, 5),
  ('00000000-0000-0000-0000-0000000127c2', '00000000-0000-0000-0000-0000000127e2', 'Gold', 20000, 20000, null, 5);

-- A closed gala takes no admin pledge, and nothing is saved.
select throws_ok(
  $$select public.admin_pledge_sponsorship(
    '00000000-0000-0000-0000-0000000127a1', '00000000-0000-0000-0000-0000000127e2',
    'Closed Co', 'closed@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000127c2","count":1}]',
    array[repeat('a', 64)])$$,
  '55000', 'pledge_event_closed', 'an admin pledge into a closed gala is refused');

select is(
  (select count(*)::int from public.sponsors where event_id = '00000000-0000-0000-0000-0000000127e2'),
  0, 'the refused closed-gala pledge saved no sponsor');

-- Blank sponsor name or email is refused before any row is written.
select throws_ok(
  $$select public.admin_pledge_sponsorship(
    '00000000-0000-0000-0000-0000000127a1', '00000000-0000-0000-0000-0000000127e1',
    '   ', 'blank@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000127c1","count":1}]',
    array[repeat('b', 64)])$$,
  '22023', null, 'an admin pledge with a blank sponsor name is refused');

select throws_ok(
  $$select public.admin_pledge_sponsorship(
    '00000000-0000-0000-0000-0000000127a1', '00000000-0000-0000-0000-0000000127e1',
    'No Email Co', '',
    '[{"tier_id":"00000000-0000-0000-0000-0000000127c1","count":1}]',
    array[repeat('b', 64)])$$,
  '22023', null, 'an admin pledge with a blank sponsor email is refused');

select is(
  (select count(*)::int from public.sponsors where event_id = '00000000-0000-0000-0000-0000000127e1'),
  0, 'the refused blank pledges saved no sponsor');

-- A cancelled sponsorship's table takes no admin guest.
create temp table pledged as
select public.admin_pledge_sponsorship(
  '00000000-0000-0000-0000-0000000127a1', '00000000-0000-0000-0000-0000000127e1',
  'Cancelled Co', 'cancelled@example.test',
  '[{"tier_id":"00000000-0000-0000-0000-0000000127c1","count":1}]',
  array[repeat('c', 64)]) as r;
update public.sponsorships set status = 'cancelled'
where id = (select (r ->> 'sponsorship_id')::uuid from pledged);

select throws_ok(
  $$select public.admin_add_sponsored_guests(
    '00000000-0000-0000-0000-0000000127a1', '00000000-0000-0000-0000-0000000127e1',
    (select id from public.sponsored_tables where invite_token_hash = repeat('c', 64)),
    '[{"full_name":"Late Guest","email":"late@example.test"}]')$$,
  'P0002', null, 'an admin guest on a cancelled sponsorship''s table is refused');

select is(
  (select count(*)::int from public.registrations r
   join public.sponsored_tables st on st.id = r.sponsored_table_id
   where st.invite_token_hash = repeat('c', 64)),
  0, 'the refused guest saved no registration');

select is(
  (select count(*)::int from public.audit_logs where action = 'sponsored_guests.admin_add'
   and actor_id = '00000000-0000-0000-0000-0000000127a1'),
  0, 'the refused guest wrote no audit row');

-- A closed gala's table takes no admin guest.
create temp table live as
select public.admin_pledge_sponsorship(
  '00000000-0000-0000-0000-0000000127a1', '00000000-0000-0000-0000-0000000127e1',
  'Live Co', 'live@example.test',
  '[{"tier_id":"00000000-0000-0000-0000-0000000127c1","count":1}]',
  array[repeat('d', 64)]) as r;
update public.events set status = 'closed' where id = '00000000-0000-0000-0000-0000000127e1';

select throws_ok(
  $$select public.admin_add_sponsored_guests(
    '00000000-0000-0000-0000-0000000127a1', '00000000-0000-0000-0000-0000000127e1',
    (select id from public.sponsored_tables where invite_token_hash = repeat('d', 64)),
    '[{"full_name":"After Close","email":"after@example.test"}]')$$,
  '55000', null, 'an admin guest after the gala closed is refused');

select is(
  (select count(*)::int from public.attendees where email = 'after@example.test'),
  0, 'the refused closed-gala guest saved no attendee');

select * from finish();
rollback;
