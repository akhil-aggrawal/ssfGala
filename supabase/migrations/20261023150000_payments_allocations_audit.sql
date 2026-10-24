-- Money and audit trail: payments, payment_allocations, stripe_webhook_events,
-- audit_logs, plus the attendee_payment_status view.
-- Source: Database Schema & Technical Design v1 (SSF Gala Product docs).
-- Additive only. Composite (id, event_id) foreign keys keep every row in one
-- event. RLS is enabled with no policies, as in the previous migrations.
-- Payments are never deleted: refunds and failures are status changes.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  registration_id uuid,
  sponsorship_id uuid,
  provider text not null check (provider in ('stripe', 'offline')),
  purpose text not null
    check (purpose in ('ticket', 'seat_contribution', 'sponsorship')),
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null
    check (status in ('pending', 'succeeded', 'refunded', 'failed')),
  -- Stripe IDs only; never card data. Unique so a session is stored once.
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  recorded_by uuid references public.profiles (id),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, event_id),
  foreign key (registration_id, event_id)
    references public.registrations (id, event_id),
  foreign key (sponsorship_id, event_id)
    references public.sponsorships (id, event_id),
  -- A sponsorship payment belongs to a sponsorship only; every other
  -- purpose belongs to a registration only.
  constraint payments_target_matches_purpose check (
    (purpose = 'sponsorship' and sponsorship_id is not null and registration_id is null)
    or (purpose <> 'sponsorship' and registration_id is not null and sponsorship_id is null)
  )
);

create index payments_event_id_registration_id_idx
  on public.payments (event_id, registration_id);
create index payments_sponsorship_id_idx
  on public.payments (sponsorship_id);

-- Lets payment_allocations reference (attendee_id, event_id).
alter table public.attendees
  add constraint attendees_id_event_id_key unique (id, event_id);

-- Which attendee a payment covers, and how much of it. An attendee is paid
-- only through a succeeded allocation, never because the registration paid.
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  payment_id uuid not null,
  attendee_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, attendee_id),
  foreign key (payment_id, event_id)
    references public.payments (id, event_id),
  foreign key (attendee_id, event_id)
    references public.attendees (id, event_id)
);

create index payment_allocations_attendee_id_idx
  on public.payment_allocations (attendee_id);
create index payment_allocations_event_id_idx
  on public.payment_allocations (event_id);

-- Stripe webhook dedupe: one row per Stripe event id (evt_...).
create table public.stripe_webhook_events (
  event_id text primary key,
  processed_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  event_id uuid references public.events (id),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_event_id_created_at_idx
  on public.audit_logs (event_id, created_at);

-- paid = true only when a succeeded payment is allocated to the attendee.
-- security_invoker keeps the callers' RLS in force on the base tables.
create view public.attendee_payment_status
  with (security_invoker = true) as
select
  a.id as attendee_id,
  a.event_id,
  a.registration_id,
  exists (
    select 1
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.attendee_id = a.id
      and p.status = 'succeeded'
  ) as paid
from public.attendees a;

alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.audit_logs enable row level security;
