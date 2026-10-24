-- QA edge cases for issue #4 (registrations, attendees).
-- Run with: supabase test db
begin;
select plan(8);

insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000031', 'Gala 2027', 2027, 'open'),
  ('00000000-0000-0000-0000-000000000032', 'Gala 2026', 2026, 'archived');

insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-000000000031', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-0000000003a2', '00000000-0000-0000-0000-000000000032', 'Gold', 20000, 20000);

insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-0000000003b1', '00000000-0000-0000-0000-000000000031', 'Acme', 'acme@example.com'),
  ('00000000-0000-0000-0000-0000000003b2', '00000000-0000-0000-0000-000000000032', 'Old Co', 'old@example.com');

insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents) values
  ('00000000-0000-0000-0000-0000000003c1', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-0000000003b1', 200000),
  ('00000000-0000-0000-0000-0000000003c2', '00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000003b2', 200000);

insert into public.sponsored_tables (id, event_id, sponsorship_id, tier_id, invite_token_hash) values
  ('00000000-0000-0000-0000-0000000003d1', '00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-0000000003c1', '00000000-0000-0000-0000-0000000003a1', 'edge-reg-1'),
  ('00000000-0000-0000-0000-0000000003d2', '00000000-0000-0000-0000-000000000032',
   '00000000-0000-0000-0000-0000000003c2', '00000000-0000-0000-0000-0000000003a2', 'edge-reg-2');

insert into public.registrations (id, event_id, kind, tier_id, sponsored_table_id) values
  ('00000000-0000-0000-0000-0000000003e1', '00000000-0000-0000-0000-000000000031', 'sponsored',
   '00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000003d1');

-- AC1: every non-sponsored kind is rejected with a table, not just individual.
select throws_ok(
  $$ insert into public.registrations (event_id, kind, tier_id, sponsored_table_id)
     values ('00000000-0000-0000-0000-000000000031', 'complimentary', '00000000-0000-0000-0000-0000000003a1',
             '00000000-0000-0000-0000-0000000003d1') $$,
  '23514', null,
  'a complimentary registration with a sponsored_table_id is rejected'
);

select throws_ok(
  $$ insert into public.registrations (event_id, kind, tier_id, sponsored_table_id)
     values ('00000000-0000-0000-0000-000000000031', 'offline_paid', '00000000-0000-0000-0000-0000000003a1',
             '00000000-0000-0000-0000-0000000003d1') $$,
  '23514', null,
  'an offline_paid registration with a sponsored_table_id is rejected'
);

select lives_ok(
  $$ insert into public.registrations (event_id, kind, tier_id)
     values ('00000000-0000-0000-0000-000000000031', 'complimentary', '00000000-0000-0000-0000-0000000003a1') $$,
  'a complimentary registration without a sponsored_table_id is accepted'
);

-- AC1: clearing the table on an existing sponsored registration is rejected too.
select throws_ok(
  $$ update public.registrations set sponsored_table_id = null
      where id = '00000000-0000-0000-0000-0000000003e1' $$,
  '23514', null,
  'an update that strips the table from a sponsored registration is rejected'
);

-- Event scope: the sponsored table must be in the registration's event.
select throws_ok(
  $$ insert into public.registrations (event_id, kind, tier_id, sponsored_table_id)
     values ('00000000-0000-0000-0000-000000000031', 'sponsored', '00000000-0000-0000-0000-0000000003a1',
             '00000000-0000-0000-0000-0000000003d2') $$,
  '23503', null,
  'a registration cannot reference a sponsored table from another event'
);

-- Event scope: the attendee must be in the registration's event.
select throws_ok(
  $$ insert into public.attendees (event_id, registration_id, full_name, email)
     values ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-0000000003e1',
             'Wrong Event', 'wrong@example.com') $$,
  '23503', null,
  'an attendee cannot point at a registration from another event'
);

-- Unknown kind is rejected.
select throws_ok(
  $$ insert into public.registrations (event_id, kind, tier_id)
     values ('00000000-0000-0000-0000-000000000031', 'vip', '00000000-0000-0000-0000-0000000003a1') $$,
  '23514', null,
  'an unknown registration kind is rejected'
);

-- One guest can be seated apart from the group.
insert into public.attendees (id, event_id, registration_id, full_name, email) values
  ('00000000-0000-0000-0000-0000000003f1', '00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-0000000003e1', 'Mover', 'mover@example.com'),
  ('00000000-0000-0000-0000-0000000003f2', '00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-0000000003e1', 'Stayer', 'stayer@example.com');
update public.attendees set assigned_table_number = '7'
 where id = '00000000-0000-0000-0000-0000000003f1';

select results_eq(
  $$ select full_name, assigned_table_number from public.attendees
      where registration_id = '00000000-0000-0000-0000-0000000003e1' order by full_name $$,
  $$ values ('Mover'::text, '7'::text), ('Stayer'::text, null::text) $$,
  'one attendee can move tables without moving the rest of the registration'
);

select * from finish();
rollback;
