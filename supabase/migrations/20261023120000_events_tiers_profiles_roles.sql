-- Core gala tables: events, profiles, user_roles, seating_tiers.
-- Source: Database Schema & Technical Design v1 (SSF Gala Product docs).
-- Additive only. RLS is enabled with no policies, so the anon and
-- authenticated roles see nothing until policies land in a later migration;
-- the Next.js server uses the service role, which bypasses RLS.

create extension if not exists pgcrypto;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year int not null unique,
  date_at timestamptz,
  venue text,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed', 'archived')),
  created_at timestamptz not null default now()
);

-- One active gala at a time: at most one event is draft or open.
create unique index one_active_gala on public.events ((true))
  where status in ('draft', 'open');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id),
  role text not null check (role in ('admin', 'sponsor', 'attendee')),
  primary key (user_id, role)
);

create table public.seating_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  name text not null check (name in ('Silver', 'Gold', 'Platinum')),
  seat_price_cents bigint not null check (seat_price_cents >= 0),
  suggested_contribution_cents bigint not null
    check (suggested_contribution_cents >= 0),
  sponsorship_amount_cents bigint check (sponsorship_amount_cents >= 0),
  table_inventory int not null default 0 check (table_inventory >= 0),
  -- unique (event_id, name) also serves as the event_id index.
  unique (event_id, name),
  -- lets later tables reference (tier_id, event_id) to stay in one event.
  unique (id, event_id)
);

alter table public.events enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.seating_tiers enable row level security;
