-- Run with: supabase test db
-- Server-made table ids on a pledge (issue #18): the server signs each table's
-- invite token with its id, so the ids it sends must be the ids stored.
begin;
select plan(5);

update public.events set status = 'closed' where status in ('draft', 'open');

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000018b1', 'ids@example.test');
insert into public.profiles (id, email)
values ('00000000-0000-0000-0000-0000000018b1', 'ids@example.test');

insert into public.events (id, name, year, status)
values ('00000000-0000-0000-0000-0000000018e1', 'Ids gala', 9181, 'open');
insert into public.seating_tiers
  (id, event_id, name, seat_price_cents, suggested_contribution_cents, sponsorship_amount_cents, table_inventory)
values
  ('00000000-0000-0000-0000-0000000018c1', '00000000-0000-0000-0000-0000000018e1', 'Gold', 20000, 20000, null, 5),
  ('00000000-0000-0000-0000-0000000018c2', '00000000-0000-0000-0000-0000000018e1', 'Silver', 15000, 15000, null, 5);

create temp table pledged as
select public.pledge_sponsorship(
  '00000000-0000-0000-0000-0000000018b1',
  '00000000-0000-0000-0000-0000000018e1',
  'Ids Family', 'ids@example.test',
  '[{"tier_id":"00000000-0000-0000-0000-0000000018c1","count":2,
     "table_ids":["00000000-0000-0000-0000-0000000018a1","00000000-0000-0000-0000-0000000018a2"]},
    {"tier_id":"00000000-0000-0000-0000-0000000018c2","count":1,
     "table_ids":["00000000-0000-0000-0000-0000000018a3"]}]',
  array[repeat('1', 64), repeat('2', 64), repeat('3', 64)]
) as r;

select results_eq(
  $$select id::text, tier_id::text, invite_token_hash from public.sponsored_tables
    where sponsorship_id = (select (r ->> 'sponsorship_id')::uuid from pledged) order by id$$,
  $$values ('00000000-0000-0000-0000-0000000018a1', '00000000-0000-0000-0000-0000000018c1', repeat('1', 64)),
           ('00000000-0000-0000-0000-0000000018a2', '00000000-0000-0000-0000-0000000018c1', repeat('2', 64)),
           ('00000000-0000-0000-0000-0000000018a3', '00000000-0000-0000-0000-0000000018c2', repeat('3', 64))$$,
  'each table gets the id the server sent, beside its own hash');

select throws_ok(
  $$select public.pledge_sponsorship(
    '00000000-0000-0000-0000-0000000018b1', '00000000-0000-0000-0000-0000000018e1',
    'Ids Family', 'ids@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000018c1","count":2,
       "table_ids":["00000000-0000-0000-0000-0000000018a4"]}]',
    array[repeat('4', 64), repeat('5', 64)])$$,
  '22023', null, 'fewer table ids than tables is rejected');

select throws_ok(
  $$select public.pledge_sponsorship(
    '00000000-0000-0000-0000-0000000018b1', '00000000-0000-0000-0000-0000000018e1',
    'Ids Family', 'ids@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000018c1","count":1,
       "table_ids":["00000000-0000-0000-0000-0000000018a5"]},
      {"tier_id":"00000000-0000-0000-0000-0000000018c2","count":1,
       "table_ids":["00000000-0000-0000-0000-0000000018a5"]}]',
    array[repeat('6', 64), repeat('7', 64)])$$,
  '22023', null, 'a table id repeated across tiers is rejected');

select throws_ok(
  $$select public.pledge_sponsorship(
    '00000000-0000-0000-0000-0000000018b1', '00000000-0000-0000-0000-0000000018e1',
    'Ids Family', 'ids@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000018c1","count":1,"table_ids":["not-a-uuid"]}]',
    array[repeat('8', 64)])$$,
  '22023', null, 'a malformed table id is rejected');

select is(
  (select count(*)::int from public.sponsored_tables where event_id = '00000000-0000-0000-0000-0000000018e1'),
  3, 'rejected pledges created no tables');

select * from finish();
rollback;
