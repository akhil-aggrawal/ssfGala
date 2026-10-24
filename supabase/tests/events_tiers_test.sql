-- Run with: supabase test db
begin;
select plan(9);

select has_table('public', 'events', 'events table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'user_roles', 'user_roles table exists');
select has_table('public', 'seating_tiers', 'seating_tiers table exists');

insert into public.events (id, name, year, status)
values ('00000000-0000-0000-0000-000000000001', 'Gala 2027', 2027, 'draft');

select throws_ok(
  $$ insert into public.events (name, year, status) values ('Gala 2028', 2028, 'open') $$,
  '23505', null,
  'a second open event fails while one is draft'
);

update public.events set status = 'open'
where id = '00000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ insert into public.events (name, year, status) values ('Gala 2028', 2028, 'open') $$,
  '23505', null,
  'a second open event fails while one is open'
);

select throws_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents)
     values ('00000000-0000-0000-0000-000000000001', 'Gold', -1, 0) $$,
  '23514', null,
  'a negative seat price is rejected'
);

select throws_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents)
     values ('00000000-0000-0000-0000-000000000001', 'Bronze', 10000, 0) $$,
  '23514', null,
  'a tier name other than Silver, Gold or Platinum is rejected'
);

select lives_ok(
  $$ insert into public.seating_tiers (event_id, name, seat_price_cents, suggested_contribution_cents)
     values ('00000000-0000-0000-0000-000000000001', 'Silver', 15000, 15000) $$,
  'a valid Silver tier is accepted'
);

select * from finish();
rollback;
