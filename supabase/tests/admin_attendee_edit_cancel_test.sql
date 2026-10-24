-- Issue #26: admin edits and cancels an attendee.
-- Run with: supabase test db
begin;
select plan(14);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000002601', 'Gala 2026 test', 2626, 'open'),
  ('00000000-0000-0000-0000-000000002602', 'Archived 2026 test', 2627, 'archived');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002603', 'admin26@example.test');
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-000000002603', 'admin26@example.test');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-000000002604', '00000000-0000-0000-0000-000000002601', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-000000002605', '00000000-0000-0000-0000-000000002602', 'Gold', 20000, 20000);

insert into public.registrations (id, event_id, kind, tier_id) values
  ('00000000-0000-0000-0000-000000002606', '00000000-0000-0000-0000-000000002601', 'individual', '00000000-0000-0000-0000-000000002604'),
  ('00000000-0000-0000-0000-000000002607', '00000000-0000-0000-0000-000000002602', 'individual', '00000000-0000-0000-0000-000000002605');

insert into public.attendees (id, event_id, registration_id, full_name, email) values
  ('00000000-0000-0000-0000-000000002608', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002606', 'Ann Typo', 'ann@exmaple.test'),
  ('00000000-0000-0000-0000-000000002609', '00000000-0000-0000-0000-000000002602', '00000000-0000-0000-0000-000000002607', 'Old Guest', 'old@example.test');

insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status) values
  ('00000000-0000-0000-0000-000000002610', '00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002606', 'stripe', 'ticket', 20000, 'succeeded');
insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents) values
  ('00000000-0000-0000-0000-000000002601', '00000000-0000-0000-0000-000000002610', '00000000-0000-0000-0000-000000002608', 20000);

-- AC3: an edit changes name and email and writes one audit row with before and after.
select public.admin_update_attendee(
  '00000000-0000-0000-0000-000000002603', '00000000-0000-0000-0000-000000002601',
  '00000000-0000-0000-0000-000000002608', '  Ann Typed ', 'ann@example.test');

select row_eq(
  $$ select full_name, email from public.attendees where id = '00000000-0000-0000-0000-000000002608' $$,
  row('Ann Typed'::text, 'ann@example.test'::text),
  'the edit trims and saves name and email'
);
select row_eq(
  $$ select actor_id, action, entity_type, before_data ->> 'full_name', before_data ->> 'email',
            after_data ->> 'full_name', after_data ->> 'email'
       from public.audit_logs
      where entity_id = '00000000-0000-0000-0000-000000002608' and action = 'attendee.update' $$,
  row('00000000-0000-0000-0000-000000002603'::uuid, 'attendee.update'::text, 'attendee'::text,
      'Ann Typo'::text, 'ann@exmaple.test'::text, 'Ann Typed'::text, 'ann@example.test'::text),
  'the edit writes an audit row with before and after values'
);

select throws_ok(
  $$ select public.admin_update_attendee(
       '00000000-0000-0000-0000-000000002603', '00000000-0000-0000-0000-000000002601',
       '00000000-0000-0000-0000-000000002608', ' ', 'ann@example.test') $$,
  '22023', null, 'a blank name is refused'
);

-- Event scope: an attendee of another event is not found from this one.
select throws_ok(
  $$ select public.admin_update_attendee(
       '00000000-0000-0000-0000-000000002603', '00000000-0000-0000-0000-000000002601',
       '00000000-0000-0000-0000-000000002609', 'X', 'x@example.test') $$,
  'P0002', null, 'an attendee of another event is not found'
);

-- Archived galas are read-only.
select throws_ok(
  $$ select public.admin_update_attendee(
       '00000000-0000-0000-0000-000000002603', '00000000-0000-0000-0000-000000002602',
       '00000000-0000-0000-0000-000000002609', 'X', 'x@example.test') $$,
  '55000', null, 'an archived gala refuses edits'
);
select throws_ok(
  $$ select public.admin_cancel_attendee(
       '00000000-0000-0000-0000-000000002603', '00000000-0000-0000-0000-000000002602',
       '00000000-0000-0000-0000-000000002609') $$,
  '55000', null, 'an archived gala refuses cancels'
);

-- AC2: cancel sets cancelled_at and keeps every payment row.
select public.admin_cancel_attendee(
  '00000000-0000-0000-0000-000000002603', '00000000-0000-0000-0000-000000002601',
  '00000000-0000-0000-0000-000000002608');

select isnt(
  (select cancelled_at from public.attendees where id = '00000000-0000-0000-0000-000000002608'),
  null, 'cancel sets cancelled_at'
);
select is(
  (select count(*)::int from public.attendees where id = '00000000-0000-0000-0000-000000002608'),
  1, 'the attendee row is kept'
);
select is(
  (select count(*)::int from public.payments where id = '00000000-0000-0000-0000-000000002610' and status = 'succeeded'),
  1, 'the payment row is kept unchanged'
);
select is(
  (select count(*)::int from public.payment_allocations where attendee_id = '00000000-0000-0000-0000-000000002608'),
  1, 'the payment allocation is kept'
);
select row_eq(
  $$ select before_data ->> 'cancelled_at', after_data ->> 'cancelled_at' is not null
       from public.audit_logs
      where entity_id = '00000000-0000-0000-0000-000000002608' and action = 'attendee.cancel' $$,
  row(null::text, true),
  'the cancel writes an audit row'
);

select throws_ok(
  $$ select public.admin_cancel_attendee(
       '00000000-0000-0000-0000-000000002603', '00000000-0000-0000-0000-000000002601',
       '00000000-0000-0000-0000-000000002608') $$,
  'P0001', 'attendee_already_cancelled', 'a second cancel is refused'
);

-- Only the service role may call them; the server checks the admin role first.
select ok(
  not has_function_privilege('authenticated',
    'public.admin_update_attendee(uuid, uuid, uuid, text, text)', 'execute'),
  'authenticated cannot edit attendees directly'
);
select ok(
  not has_function_privilege('anon',
    'public.admin_cancel_attendee(uuid, uuid, uuid)', 'execute'),
  'anon cannot cancel attendees directly'
);

select * from finish();
rollback;
