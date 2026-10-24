-- Run with: supabase test db
begin;
select plan(13);

-- Only one gala may be active: close any existing one inside this test.
update public.events set status = 'closed' where status in ('draft', 'open');

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000b1', 'sponsor@example.test');
insert into public.profiles (id, email)
values ('00000000-0000-0000-0000-0000000000b1', 'sponsor@example.test');

insert into public.events (id, name, year, status)
values ('00000000-0000-0000-0000-0000000000e1', 'Pledge gala', 9101, 'open');
insert into public.seating_tiers
  (id, event_id, name, seat_price_cents, suggested_contribution_cents, sponsorship_amount_cents, table_inventory)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 'Silver', 15000, 15000, 150000, 1),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e1', 'Gold', 20000, 20000, null, 2);

create temp table pledged as
select public.pledge_sponsorship(
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000e1',
  'Acme Family', 'sponsor@example.test',
  '[{"tier_id":"00000000-0000-0000-0000-0000000000c2","count":2},
    {"tier_id":"00000000-0000-0000-0000-0000000000c1","count":1}]',
  array[repeat('a', 64), repeat('b', 64), repeat('c', 64)]
) as r;

select is(
  (select count(*)::int from public.sponsored_tables
   where sponsorship_id = (select (r ->> 'sponsorship_id')::uuid from pledged)),
  3, 'pledging 3 tables creates 3 sponsored tables');

select is(
  (select count(distinct invite_token_hash)::int from public.sponsored_tables
   where sponsorship_id = (select (r ->> 'sponsorship_id')::uuid from pledged)),
  3, 'each table gets its own token hash');

select is(
  (select r ->> 'pledged_cents' from pledged), '550000',
  'pledged amount: 2 Gold at 10 seats x $200 + 1 Silver at $1,500');

select is(
  (select pledged_cents from public.sponsorships
   where id = (select (r ->> 'sponsorship_id')::uuid from pledged)),
  550000::bigint, 'the sponsorship stores the pledged cents');

select ok(
  exists (select 1 from public.user_roles
          where user_id = '00000000-0000-0000-0000-0000000000b1' and role = 'sponsor'),
  'the pledger gets the sponsor role');

select is(
  (select action from public.audit_logs
   where entity_id = (select (r ->> 'sponsorship_id')::uuid from pledged)),
  'sponsorship.pledge', 'the pledge writes an audit_logs row');

-- Silver has 0 left now, Gold 0 left.
select throws_ok(
  $$select public.pledge_sponsorship(
    '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
    'Acme Family', 'sponsor@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000000c1","count":1}]',
    array[repeat('d', 64)])$$,
  'P0001', null, 'a pledge past remaining inventory is rejected');

select is(
  (select count(*)::int from public.sponsorships where event_id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'the rejected pledge created no sponsorship');

select is(
  (select count(*)::int from public.sponsored_tables where event_id = '00000000-0000-0000-0000-0000000000e1'),
  3, 'the rejected pledge created no tables');

-- Cancelled sponsorships give their tables back.
update public.sponsorships set status = 'cancelled'
where id = (select (r ->> 'sponsorship_id')::uuid from pledged);

select lives_ok(
  $$select public.pledge_sponsorship(
    '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
    'Acme Family', 'sponsor@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000000c1","count":1}]',
    array[repeat('d', 64)])$$,
  'tables on a cancelled sponsorship count as available again');

select throws_ok(
  $$select public.pledge_sponsorship(
    '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
    'Acme Family', 'sponsor@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000000c2","count":1}]',
    array['not-a-hash'])$$,
  '22023', null, 'a raw token instead of a SHA-256 hash is refused');

update public.events set status = 'closed' where id = '00000000-0000-0000-0000-0000000000e1';
select throws_ok(
  $$select public.pledge_sponsorship(
    '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1',
    'Acme Family', 'sponsor@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000000c2","count":1}]',
    array[repeat('e', 64)])$$,
  '55000', null, 'a closed event takes no pledges');

select ok(
  not has_function_privilege('authenticated',
    'public.pledge_sponsorship(uuid, uuid, text, text, jsonb, text[])', 'execute'),
  'signed-in browsers cannot call pledge_sponsorship directly');

select * from finish();
rollback;
