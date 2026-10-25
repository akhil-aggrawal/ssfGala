-- Run with: supabase test db
-- QA edges for issue #29: a correction stays inside its gala and touches only
-- live offline sponsorship receipts.
begin;
select plan(7);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000029a1', 'qa29-admin@example.test');
insert into public.profiles (id, email)
values ('00000000-0000-0000-0000-0000000029a1', 'qa29-admin@example.test');

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-0000000029e1', 'QA29 gala', 9101, 'closed'),
  ('00000000-0000-0000-0000-0000000029e2', 'QA29 other gala', 9102, 'closed');
insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-0000000029c1', '00000000-0000-0000-0000-0000000029e1', 'Acme', 'acme@example.test');
insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-0000000029d1', '00000000-0000-0000-0000-0000000029e1',
   '00000000-0000-0000-0000-0000000029c1', 200000);

-- A sponsorship payment that came through Stripe, not an offline receipt.
insert into public.payments (id, event_id, sponsorship_id, provider, purpose, amount_cents, status)
values ('00000000-0000-0000-0000-0000000029f1', '00000000-0000-0000-0000-0000000029e1',
        '00000000-0000-0000-0000-0000000029d1', 'stripe', 'sponsorship', 10000, 'succeeded');

create temp table r1 as select public.record_sponsorship_receipt(
  '00000000-0000-0000-0000-0000000029a1', '00000000-0000-0000-0000-0000000029e1',
  '00000000-0000-0000-0000-0000000029d1', 50000, '2027-01-05') as id;

select throws_ok(
  $$ select public.correct_sponsorship_receipt(null, '00000000-0000-0000-0000-0000000029e2',
       (select id from r1), 40000, '2027-01-06') $$,
  'P0002', null, 'a receipt cannot be corrected through another gala');

select throws_ok(
  $$ select public.correct_sponsorship_receipt(null, '00000000-0000-0000-0000-0000000029e1',
       '00000000-0000-0000-0000-0000000029f1', 5000, '2027-01-06') $$,
  '55000', null, 'a Stripe payment is not an offline receipt and cannot be corrected here');

select throws_ok(
  $$ select public.correct_sponsorship_receipt(null, '00000000-0000-0000-0000-0000000029e1',
       (select id from r1), -1, '2027-01-06') $$,
  '22023', null, 'a negative correction is refused');

select throws_ok(
  $$ select public.record_sponsorship_receipt(null, '00000000-0000-0000-0000-0000000029e1',
       '00000000-0000-0000-0000-0000000029d1', 100, null) $$,
  '22023', null, 'a receipt needs a received date');

select ok(
  not has_function_privilege('authenticated',
    'public.correct_sponsorship_receipt(uuid, uuid, uuid, bigint, date)', 'execute'),
  'signed-in users cannot call the correction directly');

update public.events set status = 'archived' where id = '00000000-0000-0000-0000-0000000029e1';

select throws_ok(
  $$ select public.correct_sponsorship_receipt(null, '00000000-0000-0000-0000-0000000029e1',
       (select id from r1), 40000, '2027-01-06') $$,
  '55000', null, 'an archived gala refuses corrections');

select results_eq(
  $$ select status, amount_cents from public.payments where id = (select id from r1) $$,
  $$ values ('succeeded', 50000::bigint) $$,
  'refused corrections leave the receipt untouched');

select * from finish();
rollback;
