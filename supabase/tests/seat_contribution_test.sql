-- Issue #21: an invited guest's optional seat contribution. The guests are
-- registered first (register_sponsored_guests), then a pending
-- seat_contribution payment is stored for the Checkout session; the webhook
-- (apply_stripe_checkout_event) settles it.
-- Run with: supabase test db
begin;
select plan(9);

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000021c1', 'guest-21@example.test');
insert into public.profiles (id, email)
values ('00000000-0000-0000-0000-0000000021c1', 'guest-21@example.test');

-- One active gala at a time: park any existing one for this transaction.
update public.events set status = 'closed' where status in ('draft', 'open');
insert into public.events (id, name, year, status) values
  ('00000000-0000-0000-0000-00000000e211', 'Contribution test gala', 9211, 'open');
insert into public.seating_tiers (id, event_id, name, seat_price_cents, suggested_contribution_cents) values
  ('00000000-0000-0000-0000-0000000021f1', '00000000-0000-0000-0000-00000000e211', 'Gold', 20000, 20000);
insert into public.sponsors (id, event_id, display_name, email) values
  ('00000000-0000-0000-0000-0000000021a1', '00000000-0000-0000-0000-00000000e211', 'Giving Co', 'g@example.test');
insert into public.sponsorships (id, event_id, sponsor_id, pledged_cents, status) values
  ('00000000-0000-0000-0000-0000000021b1', '00000000-0000-0000-0000-00000000e211',
   '00000000-0000-0000-0000-0000000021a1', 200000, 'committed');
insert into public.sponsored_tables (id, event_id, sponsorship_id, tier_id, invite_token_hash) values
  ('00000000-0000-0000-0000-0000000021d1', '00000000-0000-0000-0000-00000000e211',
   '00000000-0000-0000-0000-0000000021b1', '00000000-0000-0000-0000-0000000021f1', repeat('d', 64));

-- Two registrations on the table: one pays, one abandons Checkout.
create temp table regs as
select 'paid'::text as k, public.register_sponsored_guests(
  '00000000-0000-0000-0000-0000000021c1', repeat('d', 64),
  '[{"full_name":"Ann","email":"a@example.test"},{"full_name":"Bo","email":"b@example.test"},
    {"full_name":"Cy","email":"c@example.test"}]') as id
union all
select 'abandoned', public.register_sponsored_guests(
  '00000000-0000-0000-0000-0000000021c1', repeat('d', 64),
  '[{"full_name":"Di","email":"d@example.test"}]');

-- What startSeatContribution stores before sending the guest to Stripe:
-- any amount, here $450.01 for three guests (not a multiple of the tier).
insert into public.payments (event_id, registration_id, provider, purpose, amount_cents, status, stripe_session_id)
select '00000000-0000-0000-0000-00000000e211', id, 'stripe', 'seat_contribution', 45001, 'pending', 'cs_test_21_' || k
from regs;

-- AC3: abandoning Checkout (session expires) leaves the registration registered
-- with no succeeded payment and no paid attendee.
select is(
  public.apply_stripe_checkout_event('evt_21_expired', 'checkout.session.expired', 'cs_test_21_abandoned', 'unpaid', 45001, null) ->> 'outcome',
  'failed', 'an expired contribution session marks its payment failed');
select is((select status from public.registrations where id = (select id from regs where k = 'abandoned')),
  'registered', 'abandoned contribution: registration stays registered');
select is((select count(*)::int from public.payments
           where registration_id = (select id from regs where k = 'abandoned') and status = 'succeeded'),
  0, 'abandoned contribution: no succeeded payment');
select is((select count(*)::int from public.attendee_payment_status
           where registration_id = (select id from regs where k = 'abandoned') and paid),
  0, 'abandoned contribution: no attendee is paid');

-- AC4: a successful payment marks each of the registration's attendees paid.
select is(
  public.apply_stripe_checkout_event('evt_21_paid', 'checkout.session.completed', 'cs_test_21_paid', 'paid', 45001, 'pi_21') ->> 'outcome',
  'confirmed', 'a paid contribution session is confirmed');
select is((select status from public.payments where stripe_session_id = 'cs_test_21_paid'),
  'succeeded', 'the seat_contribution payment succeeded');
select is((select count(*)::int from public.attendee_payment_status
           where registration_id = (select id from regs where k = 'paid') and paid),
  3, 'every attendee of the registration is paid');
select is((select sum(pa.amount_cents)::bigint from public.payment_allocations pa
           join public.payments p on p.id = pa.payment_id
           where p.stripe_session_id = 'cs_test_21_paid'),
  45001::bigint, 'the allocations add up to the amount paid');
select is((select status from public.registrations where id = (select id from regs where k = 'paid')),
  'registered', 'the paid registration is still registered');

select * from finish();
rollback;
