-- Run with: supabase test db
begin;
select plan(13);

select has_table('public', 'registrations', 'registrations table exists');
select has_table('public', 'attendees', 'attendees table exists');
select has_column('public', 'attendees', 'assigned_table_number',
  'attendees carry their own assigned_table_number');

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000021', 'Gala 2027', 2027, 'open'),
  ('00000000-0000-0000-0000-000000000022', 'Gala 2026', 2026, 'archived');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-000000000021', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-0000000002a2', '00000000-0000-0000-0000-000000000022', 'Gold', 20000, 20000);

insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-000000000021', 'Acme', 'acme@example.com');

insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-0000000002c1', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000002b1', 200000);

insert into public.sponsored_tables (id, event_id, sponsorship_id, tier_id, invite_token_hash) values
  ('00000000-0000-0000-0000-0000000002d1', '00000000-0000-0000-0000-000000000021',
   '00000000-0000-0000-0000-0000000002c1', '00000000-0000-0000-0000-0000000002a1', 'reg-hash-1');

-- AC1: sponsored needs a sponsored_table_id; other kinds must not have one
select throws_ok(
  $$ insert into public.registrations (event_id, kind, tier_id)
     values ('00000000-0000-0000-0000-000000000021', 'sponsored', '00000000-0000-0000-0000-0000000002a1') $$,
  '23514', null,
  'a sponsored registration without sponsored_table_id is rejected'
);

select throws_ok(
  $$ insert into public.registrations (event_id, kind, tier_id, sponsored_table_id)
     values ('00000000-0000-0000-0000-000000000021', 'individual', '00000000-0000-0000-0000-0000000002a1',
             '00000000-0000-0000-0000-0000000002d1') $$,
  '23514', null,
  'an individual registration with a sponsored_table_id is rejected'
);

select lives_ok(
  $$ insert into public.registrations (id, event_id, kind, tier_id, sponsored_table_id)
     values ('00000000-0000-0000-0000-0000000002e1', '00000000-0000-0000-0000-000000000021', 'sponsored',
             '00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000002d1') $$,
  'a sponsored registration with a sponsored_table_id is accepted'
);

select lives_ok(
  $$ insert into public.registrations (event_id, kind, tier_id)
     values ('00000000-0000-0000-0000-000000000021', 'individual', '00000000-0000-0000-0000-0000000002a1') $$,
  'an individual registration without a sponsored_table_id is accepted'
);

select throws_ok(
  $$ insert into public.registrations (event_id, kind, tier_id)
     values ('00000000-0000-0000-0000-000000000021', 'individual', '00000000-0000-0000-0000-0000000002a2') $$,
  '23503', null,
  'a registration cannot reference a tier from another event'
);

-- AC2: eleven attendees on one sponsored table (capacity 10) are accepted
select lives_ok(
  $$ insert into public.attendees (event_id, registration_id, full_name, email)
     select '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000002e1',
            'Guest ' || g, 'guest' || g || '@example.com'
     from generate_series(1, 11) g $$,
  'eleven attendees can be inserted against one sponsored table'
);

select is(
  (select count(*)::int from public.attendees a
     join public.registrations r on r.id = a.registration_id
    where r.sponsored_table_id = '00000000-0000-0000-0000-0000000002d1'),
  11,
  'all eleven attendees are stored'
);

-- AC3: full_name and email are required
select throws_ok(
  $$ insert into public.attendees (event_id, registration_id, email)
     values ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000002e1', 'x@example.com') $$,
  '23502', null,
  'an attendee without full_name is rejected'
);

select throws_ok(
  $$ insert into public.attendees (event_id, registration_id, full_name)
     values ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-0000000002e1', 'No Email') $$,
  '23502', null,
  'an attendee without email is rejected'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.attendees'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.registrations'::regclass),
  'RLS is enabled on registrations and attendees'
);

select * from finish();
rollback;
