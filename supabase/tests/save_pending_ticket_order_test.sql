-- Run with: supabase test db
begin;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'buyer-c1@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'buyer-c2@example.test');
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'buyer-c1@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'buyer-c2@example.test');

-- Park any active gala so this test owns the one open event.
update public.events set status = 'closed' where status in ('draft', 'open');
insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-00000000e101', 'Order test gala', 9201, 'open');
insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000001f1', '00000000-0000-0000-0000-00000000e101', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-0000000001f2', '00000000-0000-0000-0000-00000000e101', 'Silver', 15000, 15000);

-- AC2: one individual pending_payment registration with two attendees.
create temp table first_save as
select public.save_pending_ticket_order(
  '00000000-0000-0000-0000-0000000000c1', 'Gold',
  '[{"full_name":"Asha Rao","email":"asha@example.test"},{"full_name":" Ben Li ","email":"ben@example.test"}]'
) as id;

select is(
  (select kind || '/' || status from public.registrations where id = (select id from first_save)),
  'individual/pending_payment', 'the order is one individual registration, pending payment');
select is(
  (select created_by from public.registrations where id = (select id from first_save)),
  '00000000-0000-0000-0000-0000000000c1'::uuid, 'the registration belongs to the buyer');
select is(
  (select array_agg(full_name order by created_at) from public.attendees
   where registration_id = (select id from first_save) and cancelled_at is null),
  array['Asha Rao', 'Ben Li'], 'two attendees saved in entered order, names trimmed');

-- AC3: resubmitting updates the same pending registration.
create temp table second_save as
select public.save_pending_ticket_order(
  '00000000-0000-0000-0000-0000000000c1', 'Silver',
  '[{"full_name":"Asha Rao-Singh","email":"asha@example.test"},{"full_name":"Ben Li","email":"ben@example.test"}]'
) as id;

select is((select id from second_save), (select id from first_save), 'a resubmit returns the same registration');
select is(
  (select count(*)::int from public.registrations
   where created_by = '00000000-0000-0000-0000-0000000000c1'),
  1, 'no second registration is created');
select is(
  (select t.name from public.registrations r join public.seating_tiers t on t.id = r.tier_id
   where r.id = (select id from first_save)),
  'Silver', 'a changed tier is saved on the same registration');
select is(
  (select array_agg(full_name order by created_at) from public.attendees
   where registration_id = (select id from first_save)),
  array['Asha Rao-Singh', 'Ben Li'], 'attendees are edited in place, not duplicated');

-- Fewer tickets on a resubmit soft-cancels the extra attendee; more adds one.
select public.save_pending_ticket_order(
  '00000000-0000-0000-0000-0000000000c1', 'Silver',
  '[{"full_name":"Asha Rao","email":"asha@example.test"}]');
select is(
  (select array_agg(full_name order by created_at) from public.attendees
   where registration_id = (select id from first_save) and cancelled_at is null),
  array['Asha Rao'], 'a smaller order soft-cancels the extra attendee');
select public.save_pending_ticket_order(
  '00000000-0000-0000-0000-0000000000c1', 'Silver',
  '[{"full_name":"Asha Rao","email":"asha@example.test"},{"full_name":"Cara Dee","email":"cara@example.test"}]');
select is(
  (select array_agg(full_name order by created_at) from public.attendees
   where registration_id = (select id from first_save) and cancelled_at is null),
  array['Asha Rao', 'Cara Dee'], 'a larger order adds an attendee');

-- Another buyer gets their own registration.
select isnt(
  public.save_pending_ticket_order(
    '00000000-0000-0000-0000-0000000000c2', 'Gold',
    '[{"full_name":"Dev Pal","email":"dev@example.test"}]'),
  (select id from first_save), 'each buyer has their own pending order');

select throws_ok(
  $$ select public.save_pending_ticket_order('00000000-0000-0000-0000-0000000000c1', 'Gold',
       '[{"full_name":"X","email":" "}]') $$,
  '22023', null, 'an attendee without an email is rejected');
select throws_ok(
  $$ select public.save_pending_ticket_order('00000000-0000-0000-0000-0000000000c1', 'Diamond',
       '[{"full_name":"X","email":"x@example.test"}]') $$,
  '22023', null, 'an unknown tier is rejected');

update public.events set status = 'closed' where id = '00000000-0000-0000-0000-00000000e101';
select throws_ok(
  $$ select public.save_pending_ticket_order('00000000-0000-0000-0000-0000000000c1', 'Gold',
       '[{"full_name":"X","email":"x@example.test"}]') $$,
  '55000', 'ticket_order_closed', 'no order is saved while ticket sales are closed');

select ok(
  not has_function_privilege('authenticated',
    'public.save_pending_ticket_order(uuid, text, jsonb)', 'execute'),
  'signed-in users cannot call save_pending_ticket_order directly');

select * from finish();
rollback;
