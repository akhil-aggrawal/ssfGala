-- Run with: supabase test db
begin;
select plan(13);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test');
insert into public.profiles (id, email)
values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test');

create temp table tiers as select '[
  {"name":"Silver","seat_price_cents":15000,"suggested_contribution_cents":15000,"sponsorship_amount_cents":150000,"table_inventory":10},
  {"name":"Gold","seat_price_cents":20000,"suggested_contribution_cents":20000,"sponsorship_amount_cents":200000,"table_inventory":8},
  {"name":"Platinum","seat_price_cents":25000,"suggested_contribution_cents":25000,"sponsorship_amount_cents":null,"table_inventory":5}
]'::jsonb as t;

create temp table saved as
select public.save_gala_setup(
  '00000000-0000-0000-0000-0000000000a1',
  '{"name":"Gala 2027","year":2027,"date_local":"2027-01-23T18:00","venue":"ICC Milpitas","status":"draft"}',
  (select t from tiers)
) as id;

select is(
  (select count(*)::int from public.seating_tiers where event_id = (select id from saved)),
  3, 'a new event gets exactly three tiers');

select is(
  (select array_agg(seat_price_cents order by seat_price_cents) from public.seating_tiers
   where event_id = (select id from saved)),
  array[15000, 20000, 25000]::bigint[], 'seat prices are saved in cents');

select is(
  (select date_at from public.events where id = (select id from saved)),
  '2027-01-24 02:00:00+00'::timestamptz, 'the date is read as gala-local (Pacific) time');

select is(
  (select action from public.audit_logs where entity_id = (select id from saved)),
  'gala_setup.create', 'the create writes an audit_logs row');

select throws_ok(
  $$ select public.save_gala_setup(null,
       '{"name":"Gala 2028","year":2028,"status":"open"}', (select t from tiers)) $$,
  '23505', null, 'a second active event is rejected');

select is(
  (select count(*)::int from public.events where year = 2028), 0,
  'the rejected second event saved nothing');

select throws_ok(
  $$ select public.save_gala_setup(null,
       '{"name":"Gala 2029","year":2029,"status":"closed"}', (select t - 0 from tiers)) $$,
  '22023', null, 'anything but exactly three tiers is rejected');

create temp table edited as
select public.save_gala_setup(
  '00000000-0000-0000-0000-0000000000a1',
  '{"name":"Gala 2027","year":2027,"date_local":"2027-01-23T18:00","venue":"ICC Milpitas","status":"open"}',
  (select jsonb_set(t, '{0,seat_price_cents}', '17500') from tiers),
  (select id from saved));

select is(
  (select status from public.events where id = (select id from saved)), 'open',
  'an edit saves the new status');

select is(
  (select seat_price_cents from public.seating_tiers
   where event_id = (select id from saved) and name = 'Silver'),
  17500::bigint, 'an edit updates the tier in place');

select is(
  (select action from public.audit_logs
   where entity_id = (select id from saved) and action like '%update'),
  'gala_setup.update', 'the edit writes an update audit_logs row');

select ok(
  (select before_data is not null and after_data is not null from public.audit_logs
   where entity_id = (select id from saved) and action = 'gala_setup.update'),
  'the update audit row keeps before and after data');

update public.events set status = 'archived' where id = (select id from saved);

select throws_ok(
  format($$ select public.save_gala_setup(null,
       '{"name":"Changed","year":2027,"status":"open"}', (select t from tiers), %L) $$,
       (select id from saved)),
  '55000', 'gala_setup_archived', 'an archived event is read-only');

select ok(
  not has_function_privilege('authenticated', 'public.save_gala_setup(uuid, jsonb, jsonb, uuid)', 'execute'),
  'signed-in users cannot call save_gala_setup directly');

select * from finish();
rollback;
