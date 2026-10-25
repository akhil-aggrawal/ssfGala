-- Run with: supabase test db
begin;
select plan(13);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000c1', 'guest-c1@example.test');
insert into public.profiles (id, email)
values ('00000000-0000-0000-0000-0000000000c1', 'guest-c1@example.test');

-- One active gala at a time: park any existing one for this transaction.
update public.events set status = 'closed' where status in ('draft', 'open');
insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-00000000e201', 'Guests test gala', 9201, 'open'),
  ('00000000-0000-0000-0000-00000000e202', 'Closed guests gala', 9202, 'closed');
insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000002f1', '00000000-0000-0000-0000-00000000e201', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-0000000002f2', '00000000-0000-0000-0000-00000000e202', 'Gold', 20000, 20000);
insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-00000000e201', 'Open Co', 'o@example.test'),
  ('00000000-0000-0000-0000-0000000002a2', '00000000-0000-0000-0000-00000000e202', 'Closed Co', 'c@example.test');
insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents, status) values
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-0000000002a1', 200000, 'committed'),
  ('00000000-0000-0000-0000-0000000002b2', '00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-0000000002a1', 200000, 'cancelled'),
  ('00000000-0000-0000-0000-0000000002b3', '00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-0000000002a2', 200000, 'committed');
insert into public.sponsored_tables (id, event_id, sponsorship_id, tier_id, invite_token_hash) values
  ('00000000-0000-0000-0000-0000000002d1', '00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000002f1', repeat('a', 64)),
  ('00000000-0000-0000-0000-0000000002d2', '00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-0000000002b2', '00000000-0000-0000-0000-0000000002f1', repeat('b', 64)),
  ('00000000-0000-0000-0000-0000000002d3', '00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-0000000002b3', '00000000-0000-0000-0000-0000000002f2', repeat('c', 64));

-- AC1: 4 attendees → one sponsored, registered registration and 4 attendee rows.
create temp table four as
select public.register_sponsored_guests(
  '00000000-0000-0000-0000-0000000000c1', repeat('a', 64),
  '[{"full_name":"Ann","email":"a@example.test"},{"full_name":" Bo ","email":"b@example.test"},
    {"full_name":"Cy","email":"c@example.test"},{"full_name":"Di","email":"d@example.test"}]'
) as id;

select is(
  (select kind || '/' || status from public.registrations where id = (select id from four)),
  'sponsored/registered', 'the registration is sponsored and registered');
select is(
  (select sponsored_table_id::text || '/' || tier_id::text || '/' || created_by::text
   from public.registrations where id = (select id from four)),
  '00000000-0000-0000-0000-0000000002d1/00000000-0000-0000-0000-0000000002f1/00000000-0000-0000-0000-0000000000c1',
  'it is on the invite''s table, at the table''s tier, created by the guest');
select is(
  (select array_agg(full_name order by created_at) from public.attendees where registration_id = (select id from four)),
  array['Ann', 'Bo', 'Cy', 'Di'], 'four attendee rows, in order, names trimmed');
select is(
  (select count(*)::int from public.payments where registration_id = (select id from four)),
  0, 'no payment row');

-- AC2: past capacity (10) is accepted.
select lives_ok(
  $$select public.register_sponsored_guests('00000000-0000-0000-0000-0000000000c1', repeat('a', 64),
    (select jsonb_agg(jsonb_build_object('full_name', 'G' || g, 'email', 'g' || g || '@example.test'))
     from generate_series(1, 7) g))$$,
  'a registration that takes the table to 11 is accepted');
select is(
  (select count(*)::int from public.attendees a join public.registrations r on r.id = a.registration_id
   where r.sponsored_table_id = '00000000-0000-0000-0000-0000000002d1'),
  11, 'the table now has 11 attendees');

-- Errors: nothing is saved.
select throws_ok(
  $$select public.register_sponsored_guests('00000000-0000-0000-0000-0000000000c1', repeat('a', 64),
    '[{"full_name":"Ann","email":""}]')$$,
  '22023', null, 'an attendee without an email is refused');
select throws_ok(
  $$select public.register_sponsored_guests('00000000-0000-0000-0000-0000000000c1', repeat('a', 64), '[]')$$,
  '22023', null, 'no attendees is refused');
select throws_ok(
  $$select public.register_sponsored_guests('00000000-0000-0000-0000-0000000000c1', repeat('e', 64),
    '[{"full_name":"Ann","email":"a@example.test"}]')$$,
  'P0002', null, 'an unknown link is refused');
select throws_ok(
  $$select public.register_sponsored_guests('00000000-0000-0000-0000-0000000000c1', repeat('b', 64),
    '[{"full_name":"Ann","email":"a@example.test"}]')$$,
  'P0002', null, 'a cancelled sponsorship''s link is refused');
select throws_ok(
  $$select public.register_sponsored_guests('00000000-0000-0000-0000-0000000000c1', repeat('c', 64),
    '[{"full_name":"Ann","email":"a@example.test"}]')$$,
  '55000', null, 'a closed gala''s link is refused');

select is(
  has_function_privilege('authenticated', 'public.register_sponsored_guests(uuid, text, jsonb)', 'execute'),
  false, 'signed-in browsers cannot call it directly');
select is(
  has_function_privilege('anon', 'public.register_sponsored_guests(uuid, text, jsonb)', 'execute'),
  false, 'signed-out browsers cannot call it directly');

select * from finish();
rollback;
