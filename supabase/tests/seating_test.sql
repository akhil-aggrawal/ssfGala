-- Issue #28: table numbers, single-guest moves, audit rows.
-- Run with: supabase test db
begin;
select plan(14);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000281', 'Gala 2027', 2027, 'open'),
  ('00000000-0000-0000-0000-000000000289', 'Gala 1999', 1999, 'archived');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000282', 'admin28@example.test');
insert into public.profiles (id, email) values
  ('00000000-0000-0000-0000-000000000282', 'admin28@example.test');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-000000000283', '00000000-0000-0000-0000-000000000281', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-000000000293', '00000000-0000-0000-0000-000000000289', 'Gold', 20000, 20000);
insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-000000000284', '00000000-0000-0000-0000-000000000281', 'Acme', 'acme@example.test'),
  ('00000000-0000-0000-0000-000000000294', '00000000-0000-0000-0000-000000000289', 'Old', 'old@example.test');
insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-000000000285', '00000000-0000-0000-0000-000000000281', '00000000-0000-0000-0000-000000000284', 200000),
  ('00000000-0000-0000-0000-000000000295', '00000000-0000-0000-0000-000000000289', '00000000-0000-0000-0000-000000000294', 200000);
insert into public.sponsored_tables (id, event_id, sponsorship_id, tier_id, invite_token_hash) values
  ('00000000-0000-0000-0000-000000000286', '00000000-0000-0000-0000-000000000281', '00000000-0000-0000-0000-000000000285', '00000000-0000-0000-0000-000000000283', 'hash-28a'),
  ('00000000-0000-0000-0000-000000000296', '00000000-0000-0000-0000-000000000289', '00000000-0000-0000-0000-000000000295', '00000000-0000-0000-0000-000000000293', 'hash-28b');
insert into public.registrations (id, event_id, kind, tier_id, sponsored_table_id) values
  ('00000000-0000-0000-0000-000000000287', '00000000-0000-0000-0000-000000000281', 'sponsored', '00000000-0000-0000-0000-000000000283', '00000000-0000-0000-0000-000000000286');
insert into public.attendees (id, event_id, registration_id, full_name, email) values
  ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000281', '00000000-0000-0000-0000-000000000287', 'Guest A', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000002a2', '00000000-0000-0000-0000-000000000281', '00000000-0000-0000-0000-000000000287', 'Guest B', 'b@example.test');

-- AC1: the number lands on the table, so every guest of it reads it.
select public.set_table_number(
  '00000000-0000-0000-0000-000000000282', '00000000-0000-0000-0000-000000000281',
  '00000000-0000-0000-0000-000000000286', ' 12 ');

select is(
  (select physical_table_number from public.sponsored_tables
    where id = '00000000-0000-0000-0000-000000000286'),
  '12',
  'set_table_number stores the trimmed number on the table'
);

-- AC4: one audit row for the assignment, with before and after.
select row_eq(
  $$ select actor_id, action, entity_type, before_data, after_data from public.audit_logs
      where entity_id = '00000000-0000-0000-0000-000000000286' $$,
  row(
    '00000000-0000-0000-0000-000000000282'::uuid,
    'table.assign_number'::text,
    'sponsored_table'::text,
    '{"physical_table_number": null}'::jsonb,
    '{"physical_table_number": "12"}'::jsonb
  ),
  'the assignment writes one audit row'
);

-- AC2: moving one guest sets only that guest's table.
select public.move_attendee(
  '00000000-0000-0000-0000-000000000282', '00000000-0000-0000-0000-000000000281',
  '00000000-0000-0000-0000-0000000002a1', '7');

select is(
  (select assigned_table_number from public.attendees
    where id = '00000000-0000-0000-0000-0000000002a1'),
  '7',
  'the moved guest has the new table'
);
select is(
  (select assigned_table_number from public.attendees
    where id = '00000000-0000-0000-0000-0000000002a2'),
  null,
  'the other guest keeps no override'
);
select is(
  (select physical_table_number from public.sponsored_tables
    where id = '00000000-0000-0000-0000-000000000286'),
  '12',
  'the sponsored table keeps its number'
);

-- AC4: one audit row for the move.
select row_eq(
  $$ select action, entity_type, before_data, after_data from public.audit_logs
      where entity_id = '00000000-0000-0000-0000-0000000002a1' $$,
  row(
    'attendee.move'::text,
    'attendee'::text,
    '{"assigned_table_number": null}'::jsonb,
    '{"assigned_table_number": "7"}'::jsonb
  ),
  'the move writes one audit row'
);

-- An empty number clears the override (and is audited).
select public.move_attendee(
  '00000000-0000-0000-0000-000000000282', '00000000-0000-0000-0000-000000000281',
  '00000000-0000-0000-0000-0000000002a1', '');
select is(
  (select assigned_table_number from public.attendees
    where id = '00000000-0000-0000-0000-0000000002a1'),
  null,
  'an empty number sends the guest back to the table''s number'
);
select is(
  (select count(*)::int from public.audit_logs
    where entity_id = '00000000-0000-0000-0000-0000000002a1'),
  2,
  'clearing the move is audited too'
);

-- Event scope: a row from another event is not found, and nothing changes.
select throws_ok(
  $$ select public.set_table_number(
       '00000000-0000-0000-0000-000000000282', '00000000-0000-0000-0000-000000000281',
       '00000000-0000-0000-0000-000000000296', '3') $$,
  'P0002', null,
  'a table of another event is refused'
);

-- Archived events are read-only.
select throws_ok(
  $$ select public.set_table_number(
       '00000000-0000-0000-0000-000000000282', '00000000-0000-0000-0000-000000000289',
       '00000000-0000-0000-0000-000000000296', '3') $$,
  '55000', null,
  'an archived event is refused'
);
select is(
  (select physical_table_number from public.sponsored_tables
    where id = '00000000-0000-0000-0000-000000000296'),
  null,
  'the refused tables are unchanged'
);

-- A cancelled guest cannot be moved.
update public.attendees set cancelled_at = now()
 where id = '00000000-0000-0000-0000-0000000002a2';
select throws_ok(
  $$ select public.move_attendee(
       '00000000-0000-0000-0000-000000000282', '00000000-0000-0000-0000-000000000281',
       '00000000-0000-0000-0000-0000000002a2', '9') $$,
  'P0002', null,
  'a cancelled guest is refused'
);

-- Only the server (service role) may call them.
select ok(
  not has_function_privilege('anon', 'public.set_table_number(uuid, uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_table_number(uuid, uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.set_table_number(uuid, uuid, uuid, text)', 'execute'),
  'only service_role can call set_table_number'
);
select ok(
  not has_function_privilege('anon', 'public.move_attendee(uuid, uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.move_attendee(uuid, uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.move_attendee(uuid, uuid, uuid, text)', 'execute'),
  'only service_role can call move_attendee'
);

select * from finish();
rollback;
