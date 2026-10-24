-- Ticket purchases and invited-guest sign-ups: registrations, attendees.
-- Source: Database Schema & Technical Design v1 (SSF Gala Product docs).
-- Additive only. Composite (id, event_id) foreign keys keep every row in one
-- event. RLS is enabled with no policies, as in the previous migrations.
-- No cap on attendees per sponsored table: guests past capacity are
-- accepted and flagged for admins elsewhere.

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  created_by uuid references public.profiles (id),
  kind text not null
    check (kind in ('individual', 'sponsored', 'complimentary', 'offline_paid')),
  tier_id uuid not null,
  sponsored_table_id uuid,
  status text not null default 'registered'
    check (status in ('pending_payment', 'registered', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (id, event_id),
  foreign key (tier_id, event_id)
    references public.seating_tiers (id, event_id),
  foreign key (sponsored_table_id, event_id)
    references public.sponsored_tables (id, event_id),
  -- A sponsored registration belongs to exactly one table; no other kind has one.
  constraint registrations_sponsored_table_matches_kind check (
    (kind = 'sponsored' and sponsored_table_id is not null)
    or (kind <> 'sponsored' and sponsored_table_id is null)
  )
);

create index registrations_event_id_kind_status_idx
  on public.registrations (event_id, kind, status);
create index registrations_sponsored_table_id_idx
  on public.registrations (sponsored_table_id);
create index registrations_created_by_idx
  on public.registrations (created_by);

create table public.attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  registration_id uuid not null,
  full_name text not null,
  email text not null,
  -- Per-attendee seat so admins can move one guest without moving the group.
  assigned_table_number text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (registration_id, event_id)
    references public.registrations (id, event_id)
);

create index attendees_registration_id_idx
  on public.attendees (registration_id);
create index attendees_event_id_idx
  on public.attendees (event_id);

alter table public.registrations enable row level security;
alter table public.attendees enable row level security;
