-- Run with: supabase test db
begin;
select plan(13);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test');
insert into public.profiles (id, email)
values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.test');

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-00000000e001', 'Receipts gala', 9001, 'closed'),
  ('00000000-0000-0000-0000-00000000e002', 'Other gala', 9000, 'closed');
insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000e001', 'Acme', 'acme@example.test');
insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000e001',
   '00000000-0000-0000-0000-00000000c001', 200000);

create temp table r1 as select public.record_sponsorship_receipt(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001',
  '00000000-0000-0000-0000-00000000d001', 50000, '2027-01-05') as id;
create temp table r2 as select public.record_sponsorship_receipt(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001',
  '00000000-0000-0000-0000-00000000d001', 30000, '2027-01-12') as id;

select is(
  (select sum(amount_cents)::bigint from public.payments
   where sponsorship_id = '00000000-0000-0000-0000-00000000d001' and status = 'succeeded'),
  80000::bigint, 'two partial receipts total $800');

select results_eq(
  $$ select provider, purpose, status, recorded_by, received_at
     from public.payments where id = (select id from r1) $$,
  $$ values ('offline', 'sponsorship', 'succeeded',
             '00000000-0000-0000-0000-0000000000a1'::uuid,
             '2027-01-05 08:00:00+00'::timestamptz) $$,
  'a receipt stores amount source, recorded_by and the received date (Pacific)');

select is(
  (select count(*)::int from public.audit_logs
   where entity_id = (select id from r1) and action = 'sponsorship_receipt.create'),
  1, 'recording a receipt writes an audit row');

create temp table fixed as select public.correct_sponsorship_receipt(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001',
  (select id from r2), 35000, '2027-01-13') as id;

select is(
  (select status from public.payments where id = (select id from r2)), 'refunded',
  'the corrected receipt is kept, marked refunded');

select is(
  (select amount_cents from public.payments where id = (select id from r2)), 30000::bigint,
  'the corrected receipt keeps its original amount');

select results_eq(
  $$ select amount_cents, status, sponsorship_id from public.payments where id = (select id from fixed) $$,
  $$ values (35000::bigint, 'succeeded', '00000000-0000-0000-0000-00000000d001'::uuid) $$,
  'the correction is a new succeeded row on the same sponsorship');

select results_eq(
  $$ select action, before_data ->> 'id', after_data -> 'replacement' ->> 'id'
     from public.audit_logs where entity_id = (select id from r2)
       and action = 'sponsorship_receipt.correct' $$,
  $$ values ('sponsorship_receipt.correct', (select id::text from r2), (select id::text from fixed)) $$,
  'the correction writes an audit row naming the original and the replacement');

select throws_ok(
  $$ select public.correct_sponsorship_receipt(null, '00000000-0000-0000-0000-00000000e001',
       (select id from r2), 1000, '2027-01-14') $$,
  '55000', null, 'an already-corrected receipt cannot be corrected again');

create temp table voided as select public.correct_sponsorship_receipt(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001',
  (select id from fixed), 0, '2027-01-13') as id;

select ok(
  (select id from voided) is null
  and (select status from public.payments where id = (select id from fixed)) = 'refunded',
  'a zero correction voids the receipt without a new row');

select throws_ok(
  $$ select public.record_sponsorship_receipt(null, '00000000-0000-0000-0000-00000000e002',
       '00000000-0000-0000-0000-00000000d001', 100, '2027-01-05') $$,
  'P0002', null, 'a sponsorship from another event is refused');

select throws_ok(
  $$ select public.record_sponsorship_receipt(null, '00000000-0000-0000-0000-00000000e001',
       '00000000-0000-0000-0000-00000000d001', 0, '2027-01-05') $$,
  '22023', null, 'a receipt must be more than $0');

update public.events set status = 'archived' where id = '00000000-0000-0000-0000-00000000e001';

select throws_ok(
  $$ select public.record_sponsorship_receipt(null, '00000000-0000-0000-0000-00000000e001',
       '00000000-0000-0000-0000-00000000d001', 100, '2027-01-05') $$,
  '55000', null, 'an archived gala is read-only');

select ok(
  not has_function_privilege('authenticated',
    'public.record_sponsorship_receipt(uuid, uuid, uuid, bigint, date)', 'execute'),
  'signed-in users cannot call the writer directly');

select * from finish();
rollback;
