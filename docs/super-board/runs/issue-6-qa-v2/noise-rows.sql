-- Extra rows that belong to no test: two archived events (the one_active_gala
-- index allows only one draft or open event, which the test fixture takes),
-- another sponsor with a guest, and audit rows. The RLS checks must stay
-- green with these present.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000901', 'noise-sponsor@example.com'),
  ('00000000-0000-0000-0000-000000000902', 'noise-guest@example.com');
insert into public.profiles (id, email) select id, email from auth.users
  where id::text like '00000000-0000-0000-0000-00000000090_';
insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-000000000910', 'Noise Gala', 2026, 'archived'),
  ('00000000-0000-0000-0000-000000000919', 'Noise Old Gala', 2025, 'archived');
insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-000000000910', 'Gold', 20000, 20000),
  ('00000000-0000-0000-0000-000000000918', '00000000-0000-0000-0000-000000000919', 'Gold', 20000, 20000);
insert into public.sponsors (id, event_id, user_id, display_name, email) values
  ('00000000-0000-0000-0000-000000000921', '00000000-0000-0000-0000-000000000910',
   '00000000-0000-0000-0000-000000000901', 'Noise Co', 'noise-sponsor@example.com');
insert into public.registrations (id, event_id, created_by, kind, tier_id, sponsored_table_id) values
  ('00000000-0000-0000-0000-000000000951', '00000000-0000-0000-0000-000000000910',
   '00000000-0000-0000-0000-000000000902', 'individual',
   '00000000-0000-0000-0000-000000000911', null);
insert into public.attendees (id, event_id, registration_id, full_name, email) values
  ('00000000-0000-0000-0000-000000000961', '00000000-0000-0000-0000-000000000910',
   '00000000-0000-0000-0000-000000000951', 'Noise Guest', 'noise@example.com');
insert into public.audit_logs (event_id, actor_id, action, entity_type) values
  ('00000000-0000-0000-0000-000000000910', '00000000-0000-0000-0000-000000000901', 'update', 'sponsors');
