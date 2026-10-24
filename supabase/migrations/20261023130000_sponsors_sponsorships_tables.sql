-- Sponsor pledges and per-table invitation links: sponsors, sponsorships,
-- sponsored_tables.
-- Source: Database Schema & Technical Design v1 (SSF Gala Product docs).
-- Additive only. Composite (id, event_id) foreign keys keep every row in one
-- event. RLS is enabled with no policies, as in the previous migration.
-- capacity is the nominal seat count; guests past it are accepted and
-- flagged for admins elsewhere, so nothing here caps registrations.

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  user_id uuid references public.profiles (id),
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  unique (id, event_id)
);

create index sponsors_event_id_user_id_idx
  on public.sponsors (event_id, user_id);

create table public.sponsorships (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  sponsor_id uuid not null,
  pledged_cents bigint not null check (pledged_cents >= 0),
  status text not null default 'committed'
    check (status in ('committed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (id, event_id),
  foreign key (sponsor_id, event_id)
    references public.sponsors (id, event_id)
);

-- Also serves the composite sponsor foreign key lookups.
create index sponsorships_event_id_sponsor_id_idx
  on public.sponsorships (event_id, sponsor_id);

create table public.sponsored_tables (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  sponsorship_id uuid not null,
  tier_id uuid not null,
  -- Only the hash of the invite token is stored; the raw token lives in the link.
  invite_token_hash text not null unique,
  capacity int not null default 10 check (capacity > 0),
  physical_table_number text,
  created_at timestamptz not null default now(),
  unique (id, event_id),
  foreign key (sponsorship_id, event_id)
    references public.sponsorships (id, event_id),
  foreign key (tier_id, event_id)
    references public.seating_tiers (id, event_id)
);

create index sponsored_tables_event_id_sponsorship_id_idx
  on public.sponsored_tables (event_id, sponsorship_id);

alter table public.sponsors enable row level security;
alter table public.sponsorships enable row level security;
alter table public.sponsored_tables enable row level security;
