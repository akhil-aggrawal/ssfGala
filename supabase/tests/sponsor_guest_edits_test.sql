-- Issue #23: sponsors edit their guests and remove only unpaid ones.
-- Run with: supabase test db
begin;
select plan(21);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000231', 'Gala 2027', 2027, 'open'),
  ('00000000-0000-0000-0000-000000000239', 'Gala 1999', 1999, 'archived');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000232', 'sponsor-a@example.test'),
  ('00000000-0000-0000-0000-000000000233', 'sponsor-b@example.test');
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-000000000232', 'sponsor-a@example.test'),
  ('00000000-0000-0000-0000-000000000233', 'sponsor-b@example.test');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-000000000234', '00000000-0000-0000-0000-000000000231', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-000000000244', '00000000-0000-0000-0000-000000000239', 'Gold', 20000, 20000);
insert into public.sponsors (id, event_id, user_id, display_name, email) values
  ('00000000-0000-0000-0000-000000000235', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000232', 'Acme', 'a@example.test'),
  ('00000000-0000-0000-0000-000000000236', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000233', 'Bolt', 'b@example.test'),
  ('00000000-0000-0000-0000-000000000245', '00000000-0000-0000-0000-000000000239', '00000000-0000-0000-0000-000000000232', 'Acme', 'a@example.test');
insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-000000000237', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000235', 200000),
  ('00000000-0000-0000-0000-000000000238', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000236', 200000),
  ('00000000-0000-0000-0000-000000000247', '00000000-0000-0000-0000-000000000239', '00000000-0000-0000-0000-000000000245', 200000);
insert into public.sponsored_tables (id, event_id, sponsorship_id, tier_id, invite_token_hash) values
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000237', '00000000-0000-0000-0000-000000000234', 'hash-23a'),
  ('00000000-0000-0000-0000-0000000002b2', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000238', '00000000-0000-0000-0000-000000000234', 'hash-23b'),
  ('00000000-0000-0000-0000-0000000002b9', '00000000-0000-0000-0000-000000000239', '00000000-0000-0000-0000-000000000247', '00000000-0000-0000-0000-000000000244', 'hash-23z');
insert into public.registrations (id, event_id, kind, tier_id, sponsored_table_id) values
  ('00000000-0000-0000-0000-0000000002c1', '00000000-0000-0000-0000-000000000231', 'sponsored', '00000000-0000-0000-0000-000000000234', '00000000-0000-0000-0000-0000000002b1'),
  ('00000000-0000-0000-0000-0000000002c2', '00000000-0000-0000-0000-000000000231', 'sponsored', '00000000-0000-0000-0000-000000000234', '00000000-0000-0000-0000-0000000002b2'),
  ('00000000-0000-0000-0000-0000000002c9', '00000000-0000-0000-0000-000000000239', 'sponsored', '00000000-0000-0000-0000-000000000244', '00000000-0000-0000-0000-0000000002b9');
insert into public.attendees (id, event_id, registration_id, full_name, email) values
  -- A1 unpaid and A2 paid on sponsor A's table; A3 on sponsor B's table.
  ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-0000000002c1', 'Guest One', 'one@example.test'),
  ('00000000-0000-0000-0000-0000000002a2', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-0000000002c1', 'Guest Two', 'two@example.test'),
  ('00000000-0000-0000-0000-0000000002a3', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-0000000002c2', 'Guest Three', 'three@example.test'),
  ('00000000-0000-0000-0000-0000000002a9', '00000000-0000-0000-0000-000000000239', '00000000-0000-0000-0000-0000000002c9', 'Old Guest', 'old@example.test');
insert into public.payments (id, event_id, registration_id, provider, purpose, amount_cents, status) values
  ('00000000-0000-0000-0000-0000000002d1', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-0000000002c1', 'stripe', 'seat_contribution', 5000, 'succeeded');
insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents) values
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-0000000002d1', '00000000-0000-0000-0000-0000000002a2', 5000);

-- Edit: the owner changes a guest's name and email.
select public.sponsor_update_guest(
  '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
  '00000000-0000-0000-0000-0000000002a1', ' Guest Uno ', ' uno@example.test ');

select row_eq(
  $$ select full_name, email from public.attendees where id = '00000000-0000-0000-0000-0000000002a1' $$,
  row('Guest Uno'::text, 'uno@example.test'::text),
  'the owner edits a guest name and email, trimmed'
);

-- AC4: the edit writes one audit row with before and after.
select row_eq(
  $$ select event_id, actor_id, action, entity_type, before_data, after_data from public.audit_logs
      where entity_id = '00000000-0000-0000-0000-0000000002a1' $$,
  row(
    '00000000-0000-0000-0000-000000000231'::uuid,
    '00000000-0000-0000-0000-000000000232'::uuid,
    'attendee.update'::text,
    'attendee'::text,
    '{"full_name": "Guest One", "email": "one@example.test"}'::jsonb,
    '{"full_name": "Guest Uno", "email": "uno@example.test"}'::jsonb
  ),
  'the edit writes one audit row with before and after'
);

select throws_ok(
  $$ select public.sponsor_update_guest(
       '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
       '00000000-0000-0000-0000-0000000002a1', ' ', 'uno@example.test') $$,
  '22023', null,
  'a blank name is refused'
);

-- A paid guest's details can still be corrected.
select lives_ok(
  $$ select public.sponsor_update_guest(
       '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
       '00000000-0000-0000-0000-0000000002a2', 'Guest Dos', 'two@example.test') $$,
  'the owner may edit a paid guest'
);

-- AC3: another sponsor's guest cannot be edited or removed.
select throws_ok(
  $$ select public.sponsor_update_guest(
       '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
       '00000000-0000-0000-0000-0000000002a3', 'Hacked', 'h@example.test') $$,
  'P0002', 'sponsor_guest_not_found',
  'a sponsor cannot edit a guest on another sponsor''s table'
);
select throws_ok(
  $$ select public.sponsor_remove_guest(
       '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
       '00000000-0000-0000-0000-0000000002a3') $$,
  'P0002', 'sponsor_guest_not_found',
  'a sponsor cannot remove a guest on another sponsor''s table'
);
select row_eq(
  $$ select full_name, cancelled_at from public.attendees where id = '00000000-0000-0000-0000-0000000002a3' $$,
  row('Guest Three'::text, null::timestamptz),
  'the other sponsor''s guest is unchanged'
);

-- Event scope: a guest outside the given gala is not found.
select throws_ok(
  $$ select public.sponsor_update_guest(
       '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000239',
       '00000000-0000-0000-0000-0000000002a1', 'X', 'x@example.test') $$,
  'P0002', 'sponsor_guest_not_found',
  'a guest outside the given gala is not found'
);

-- Archived galas are read-only.
select throws_ok(
  $$ select public.sponsor_remove_guest(
       '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000239',
       '00000000-0000-0000-0000-0000000002a9') $$,
  '55000', 'sponsor_guest_archived',
  'an archived gala is read-only'
);

-- AC2: a paid guest cannot be removed, even by the owner.
select throws_ok(
  $$ select public.sponsor_remove_guest(
       '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
       '00000000-0000-0000-0000-0000000002a2') $$,
  'P0001', 'sponsor_guest_paid',
  'removing a paid guest fails'
);
select is(
  (select cancelled_at from public.attendees where id = '00000000-0000-0000-0000-0000000002a2'),
  null,
  'the paid guest stays registered'
);

-- AC1: removing an unpaid guest soft-cancels them.
select public.sponsor_remove_guest(
  '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
  '00000000-0000-0000-0000-0000000002a1');

select isnt(
  (select cancelled_at from public.attendees where id = '00000000-0000-0000-0000-0000000002a1'),
  null,
  'removing an unpaid guest sets cancelled_at'
);
select is(
  (select count(*)::int from public.attendees
    where registration_id = '00000000-0000-0000-0000-0000000002c1' and cancelled_at is null),
  1,
  'the removed guest drops off the table count'
);

-- AC4: the removal writes one audit row with before and after.
select row_eq(
  $$ select action, before_data ->> 'cancelled_at', after_data ->> 'cancelled_at' is not null,
            before_data ->> 'full_name'
       from public.audit_logs
      where entity_id = '00000000-0000-0000-0000-0000000002a1' and action = 'attendee.cancel' $$,
  row('attendee.cancel'::text, null::text, true, 'Guest Uno'::text),
  'the removal writes one audit row with before and after'
);
select is(
  (select count(*)::int from public.audit_logs where entity_id = '00000000-0000-0000-0000-0000000002a3'),
  0,
  'refused changes write no audit rows'
);

-- A removed guest can be neither removed again nor edited.
select throws_ok(
  $$ select public.sponsor_remove_guest(
       '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
       '00000000-0000-0000-0000-0000000002a1') $$,
  'P0002', 'sponsor_guest_not_found',
  'a removed guest cannot be removed again'
);

-- AC2 and AC3 over the API: only the service role may execute the functions.
select ok(
  not has_function_privilege('authenticated', 'public.sponsor_remove_guest(uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.sponsor_remove_guest(uuid, uuid, uuid)', 'execute'),
  'browser roles cannot execute sponsor_remove_guest'
);
select ok(
  not has_function_privilege('authenticated', 'public.sponsor_update_guest(uuid, uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.sponsor_update_guest(uuid, uuid, uuid, text, text)', 'execute'),
  'browser roles cannot execute sponsor_update_guest'
);
select ok(
  has_function_privilege('service_role', 'public.sponsor_remove_guest(uuid, uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.sponsor_update_guest(uuid, uuid, uuid, text, text)', 'execute'),
  'the service role can execute both'
);

-- The paid guest's owner calling directly as an authenticated user is refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000232", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.sponsor_remove_guest(
       '00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000231',
       '00000000-0000-0000-0000-0000000002a2') $$,
  '42501', null,
  'a direct API call to remove a paid guest is refused'
);
reset role;

select is(
  (select cancelled_at from public.attendees where id = '00000000-0000-0000-0000-0000000002a2'),
  null,
  'the paid guest is still registered after the direct call'
);

select * from finish();
rollback;
