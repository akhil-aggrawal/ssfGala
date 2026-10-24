-- Run with: supabase test db
begin;
select plan(16);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000b1', 'admin-b1@example.test');
insert into public.profiles (id, email)
values ('00000000-0000-0000-0000-0000000000b1', 'admin-b1@example.test');

-- Closed and archived events stay clear of the one-active-gala index.
insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-00000000e001', 'Attendees test gala', 9101, 'closed'),
  ('00000000-0000-0000-0000-00000000e002', 'Archived test gala', 9102, 'archived');
insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000e001', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000e002', 'Gold', 20000, 20000);

-- AC1: complimentary → registered, attendees saved, no payment row.
create temp table comp as
select public.add_admin_attendees(
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-00000000e001',
  'complimentary',
  '00000000-0000-0000-0000-0000000000f1',
  '[{"full_name":"Asha Rao","email":"asha@example.test"},{"full_name":" Ben Li ","email":"ben@example.test"}]'
) as id;

select is(
  (select status || '/' || kind from public.registrations where id = (select id from comp)),
  'registered/complimentary', 'a complimentary registration is created as registered');
select is(
  (select created_by from public.registrations where id = (select id from comp)),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'the registration records the admin who added it');
select is(
  (select array_agg(full_name order by full_name) from public.attendees
   where registration_id = (select id from comp)),
  array['Asha Rao', 'Ben Li'], 'every attendee is saved, names trimmed');
select is(
  (select count(*)::int from public.payments where registration_id = (select id from comp)),
  0, 'a complimentary registration has no payment row');

-- AC2: offline paid → offline payment for the entered amount, recorded_by set.
create temp table paid as
select public.add_admin_attendees(
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-00000000e001',
  'offline_paid',
  '00000000-0000-0000-0000-0000000000f1',
  '[{"full_name":"Cara One","email":"c1@example.test"},{"full_name":"Cara Two","email":"c2@example.test"},{"full_name":"Cara Three","email":"c3@example.test"}]',
  40000
) as id;

select is(
  (select provider || '/' || purpose || '/' || status || '/' || amount_cents
   from public.payments where registration_id = (select id from paid)),
  'offline/ticket/succeeded/40000', 'a paid-offline registration stores an offline payment for the amount');
select is(
  (select recorded_by from public.payments where registration_id = (select id from paid)),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'the offline payment has recorded_by set');
select is(
  (select sum(pa.amount_cents)::bigint from public.payment_allocations pa
   join public.payments p on p.id = pa.payment_id
   where p.registration_id = (select id from paid)),
  40000::bigint, 'allocations add up to the payment');
select is(
  (select array_agg(pa.amount_cents order by a.full_name) from public.payment_allocations pa
   join public.attendees a on a.id = pa.attendee_id
   where a.registration_id = (select id from paid)),
  array[13334, 13333, 13333]::bigint[], 'the first attendee takes the leftover cent');
select is(
  (select bool_and(paid) from public.attendee_payment_status
   where registration_id = (select id from paid)),
  true, 'every paid-offline attendee reads as paid');

-- AC4: each creation writes an audit log row.
select is(
  (select array_agg(action order by action) from public.audit_logs
   where entity_id in ((select id from comp), (select id from paid))),
  array['registration.create_complimentary', 'registration.create_offline_paid'],
  'each creation writes one audit_logs row');

select throws_ok(
  $$ select public.add_admin_attendees('00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-00000000e001', 'offline_paid',
       '00000000-0000-0000-0000-0000000000f1', '[{"full_name":"X","email":"x@example.test"}]', null) $$,
  '22023', null, 'paid offline without an amount is rejected');
select throws_ok(
  $$ select public.add_admin_attendees('00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-00000000e001', 'individual',
       '00000000-0000-0000-0000-0000000000f1', '[{"full_name":"X","email":"x@example.test"}]') $$,
  '22023', null, 'only complimentary and offline_paid are accepted');
select throws_ok(
  $$ select public.add_admin_attendees('00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-00000000e001', 'complimentary',
       '00000000-0000-0000-0000-0000000000f1', '[{"full_name":"X","email":" "}]') $$,
  '22023', null, 'an attendee without an email is rejected');
select throws_ok(
  $$ select public.add_admin_attendees('00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-00000000e001', 'complimentary',
       '00000000-0000-0000-0000-0000000000f2', '[{"full_name":"X","email":"x@example.test"}]') $$,
  '23503', null, 'a tier from another event is rejected');
select throws_ok(
  $$ select public.add_admin_attendees('00000000-0000-0000-0000-0000000000b1',
       '00000000-0000-0000-0000-00000000e002', 'complimentary',
       '00000000-0000-0000-0000-0000000000f2', '[{"full_name":"X","email":"x@example.test"}]') $$,
  '55000', 'admin_attendees_archived', 'an archived event is read-only');

select ok(
  not has_function_privilege('authenticated',
    'public.add_admin_attendees(uuid, uuid, text, uuid, jsonb, bigint)', 'execute'),
  'signed-in users cannot call add_admin_attendees directly');

select * from finish();
rollback;
