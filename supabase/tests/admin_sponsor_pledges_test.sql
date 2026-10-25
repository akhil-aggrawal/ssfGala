-- Run with: supabase test db
begin;
select plan(17);

-- Only one gala may be active: close any existing one inside this test.
update public.events set status = 'closed' where status in ('draft', 'open');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000027a1', 'admin27@example.test'),
  ('00000000-0000-0000-0000-0000000027b1', 'sponsor27@example.test');
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-0000000027a1', 'admin27@example.test'),
  ('00000000-0000-0000-0000-0000000027b1', 'sponsor27@example.test');

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-0000000027e1', 'Admin pledge gala', 9271, 'open'),
  ('00000000-0000-0000-0000-0000000027e2', 'Other gala', 9272, 'closed');
insert into public.seating_tiers
  (id, event_id, name, seat_price_cents, suggested_contribution_cents, sponsorship_amount_cents, table_inventory)
values
  ('00000000-0000-0000-0000-0000000027c1', '00000000-0000-0000-0000-0000000027e1', 'Silver', 15000, 15000, 150000, 1),
  ('00000000-0000-0000-0000-0000000027c2', '00000000-0000-0000-0000-0000000027e1', 'Gold', 20000, 20000, null, 2);

-- AC1: an admin pledge builds the same sponsorship and tables as the public flow.
create temp table admin_pledged as
select public.admin_pledge_sponsorship(
  '00000000-0000-0000-0000-0000000027a1',
  '00000000-0000-0000-0000-0000000027e1',
  'Phone Family', 'Phone@Example.test',
  '[{"tier_id":"00000000-0000-0000-0000-0000000027c2","count":1},
    {"tier_id":"00000000-0000-0000-0000-0000000027c1","count":1}]',
  array[repeat('1', 64), repeat('2', 64)]
) as r;

select is(
  (select count(*)::int from public.sponsored_tables
   where sponsorship_id = (select (r ->> 'sponsorship_id')::uuid from admin_pledged)),
  2, 'an admin pledge of 2 tables creates 2 sponsored tables');

select is(
  (select array_agg(invite_token_hash order by invite_token_hash) from public.sponsored_tables
   where sponsorship_id = (select (r ->> 'sponsorship_id')::uuid from admin_pledged)),
  array[repeat('1', 64), repeat('2', 64)], 'each table stores its own invite token hash');

select is(
  (select r ->> 'pledged_cents' from admin_pledged), '350000',
  'pledged amount comes from the tiers: 1 Gold at 10 x $200 + 1 Silver at $1,500');

select is(
  (select s.display_name || '/' || s.email || '/' || coalesce(s.user_id::text, 'none')
   from public.sponsors s join public.sponsorships sp on sp.sponsor_id = s.id
   where sp.id = (select (r ->> 'sponsorship_id')::uuid from admin_pledged)),
  'Phone Family/Phone@Example.test/none', 'a new sponsor is created with no linked account');

-- AC4: the creation writes one audit row, by the admin.
select is(
  (select action || '/' || actor_id::text from public.audit_logs
   where entity_id = (select (r ->> 'sponsorship_id')::uuid from admin_pledged)),
  'sponsorship.admin_pledge/00000000-0000-0000-0000-0000000027a1',
  'the admin pledge writes an audit_logs row naming the admin');

select ok(
  not exists (select 1 from public.user_roles where user_id = '00000000-0000-0000-0000-0000000027a1' and role = 'sponsor'),
  'the admin does not become a sponsor');

-- A second admin pledge for the same email reuses that sponsor.
select lives_ok(
  $$select public.admin_pledge_sponsorship(
    '00000000-0000-0000-0000-0000000027a1', '00000000-0000-0000-0000-0000000027e1',
    'Phone Family', 'phone@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000027c2","count":1}]',
    array[repeat('3', 64)])$$,
  'a second admin pledge for the same sponsor succeeds');

select is(
  (select count(*)::int from public.sponsors where event_id = '00000000-0000-0000-0000-0000000027e1'),
  1, 'the same email (any case) reuses the sponsor');

-- Inventory is shared with the public flow: Silver and Gold are now sold out.
select throws_ok(
  $$select public.admin_pledge_sponsorship(
    '00000000-0000-0000-0000-0000000027a1', '00000000-0000-0000-0000-0000000027e1',
    'Late Co', 'late@example.test',
    '[{"tier_id":"00000000-0000-0000-0000-0000000027c1","count":1}]',
    array[repeat('4', 64)])$$,
  'P0001', null, 'an admin pledge past remaining inventory is rejected');

select is(
  (select count(*)::int from public.sponsors where email = 'late@example.test'),
  0, 'the rejected pledge saved no sponsor');

-- The public flow still works through the shared transaction.
update public.sponsorships set status = 'cancelled'
where id = (select (r ->> 'sponsorship_id')::uuid from admin_pledged);
select is(
  (select (public.pledge_sponsorship(
     '00000000-0000-0000-0000-0000000027b1', '00000000-0000-0000-0000-0000000027e1',
     'Self Co', 'sponsor27@example.test',
     '[{"tier_id":"00000000-0000-0000-0000-0000000027c1","count":1}]',
     array[repeat('5', 64)]) ->> 'pledged_cents')),
  '150000', 'the public pledge still pledges through the shared transaction');

select is(
  (select action || '/' || actor_id::text from public.audit_logs
   where entity_type = 'sponsorship' and actor_id = '00000000-0000-0000-0000-0000000027b1'),
  'sponsorship.pledge/00000000-0000-0000-0000-0000000027b1',
  'the public pledge keeps its own audit action and actor');

-- AC3: an admin adds guests to a full table; nothing caps it.
update public.sponsored_tables set capacity = 1
where invite_token_hash = repeat('3', 64);
select public.register_sponsored_guests(
  '00000000-0000-0000-0000-0000000027b1', repeat('3', 64),
  '[{"full_name":"First","email":"first@example.test"}]');

create temp table added as
select public.admin_add_sponsored_guests(
  '00000000-0000-0000-0000-0000000027a1',
  '00000000-0000-0000-0000-0000000027e1',
  (select id from public.sponsored_tables where invite_token_hash = repeat('3', 64)),
  '[{"full_name":"Extra","email":"extra@example.test"}]'
) as id;

select is(
  (select count(*)::int from public.attendees a
   join public.registrations r on r.id = a.registration_id
   join public.sponsored_tables st on st.id = r.sponsored_table_id
   where st.invite_token_hash = repeat('3', 64) and a.cancelled_at is null),
  2, 'the admin-added guest is accepted past capacity');

select is(
  (select kind || '/' || status || '/' || created_by::text from public.registrations where id = (select id from added)),
  'sponsored/registered/00000000-0000-0000-0000-0000000027a1',
  'the admin guest is a sponsored registration created by the admin');

select is(
  (select action || '/' || actor_id::text || '/' || (after_data -> 'attendees' -> 0 ->> 'full_name')
   from public.audit_logs where entity_id = (select id from added)),
  'sponsored_guests.admin_add/00000000-0000-0000-0000-0000000027a1/Extra',
  'adding guests writes an audit_logs row naming the admin and the guests');

-- Event scope: a table id from another event is not found.
select throws_ok(
  $$select public.admin_add_sponsored_guests(
    '00000000-0000-0000-0000-0000000027a1', '00000000-0000-0000-0000-0000000027e2',
    (select id from public.sponsored_tables where invite_token_hash = repeat('3', 64)),
    '[{"full_name":"X","email":"x@example.test"}]')$$,
  'P0002', null, 'a table outside the given event is refused');

select ok(
  not has_function_privilege('authenticated',
    'public.admin_pledge_sponsorship(uuid, uuid, text, text, jsonb, text[])', 'execute')
  and not has_function_privilege('authenticated',
    'public.admin_add_sponsored_guests(uuid, uuid, uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated',
    'public.create_sponsorship_tables(uuid, uuid, uuid, text, jsonb, text[])', 'execute'),
  'signed-in browsers cannot call the admin pledge functions directly');

select * from finish();
rollback;
