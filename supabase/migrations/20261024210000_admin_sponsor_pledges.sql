-- Admin-entered sponsor pledges and sponsored guests (issue #27).
-- Organizers take pledges by phone or in person; an admin enters them here.
-- Additive: no table changes. The table-creating half of pledge_sponsorship()
-- moves into create_sponsorship_tables() so the public pledge and the admin
-- pledge run the same transaction (same inventory lock, same amounts, same
-- sponsored tables). pledge_sponsorship() keeps its signature and behaviour.
-- All functions are SECURITY INVOKER: only the service role may execute them,
-- and the Next.js server checks the admin role and the active event first.

-- Shared core: validates the tables and token hashes, locks the tiers, checks
-- inventory, inserts the sponsorship and one sponsored table per pledged
-- table, and writes the audit row (p_action, by p_actor_id).
-- Errors: pledge_invalid 22023 · pledge_inventory P0001.
create function public.create_sponsorship_tables(
  p_event_id uuid,
  p_sponsor_id uuid,
  p_actor_id uuid,
  p_action text,
  p_tables jsonb,
  p_token_hashes text[]
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tier record;
  v_sponsorship_id uuid;
  v_total int := 0;
  v_pledged bigint := 0;
  v_taken int;
  v_hash_index int := 0;
  v_after jsonb;
begin
  if jsonb_typeof(p_tables) is distinct from 'array'
     or jsonb_array_length(p_tables) = 0
     or exists (
       select 1 from jsonb_array_elements(p_tables) t
       where jsonb_typeof(t -> 'count') is distinct from 'number'
          or (t ->> 'count')::numeric <> trunc((t ->> 'count')::numeric)
          or (t ->> 'count')::int < 1)
     or (select count(distinct t ->> 'tier_id') from jsonb_array_elements(p_tables) t)
        <> jsonb_array_length(p_tables) then
    raise exception 'pledge_invalid: sponsor name, email and table counts are required'
      using errcode = '22023';
  end if;

  select sum((t ->> 'count')::int) into v_total from jsonb_array_elements(p_tables) t;
  if coalesce(array_length(p_token_hashes, 1), 0) <> v_total
     or (select count(distinct h) from unnest(p_token_hashes) h) <> v_total
     or exists (select 1 from unnest(p_token_hashes) h where h !~ '^[0-9a-f]{64}$') then
    raise exception 'pledge_invalid: one distinct token hash per table is required'
      using errcode = '22023';
  end if;

  if (select count(*) from jsonb_array_elements(p_tables) t
      join public.seating_tiers s
        on s.id::text = t ->> 'tier_id' and s.event_id = p_event_id)
     <> jsonb_array_length(p_tables) then
    raise exception 'pledge_invalid: unknown tier' using errcode = '22023';
  end if;

  -- Lock the pledged tiers in a fixed order before counting what is left.
  for v_tier in
    select s.id, s.name, s.table_inventory,
           coalesce(s.sponsorship_amount_cents, s.seat_price_cents * 10) as table_cents,
           (t ->> 'count')::int as wanted
    from jsonb_array_elements(p_tables) t
    join public.seating_tiers s
      on s.id::text = t ->> 'tier_id' and s.event_id = p_event_id
    order by s.id
    for update of s
  loop
    select count(*) into v_taken
    from public.sponsored_tables st
    join public.sponsorships sp on sp.id = st.sponsorship_id
    where st.tier_id = v_tier.id and sp.status = 'committed';
    if v_tier.wanted > v_tier.table_inventory - v_taken then
      raise exception 'pledge_inventory: % has % tables left', v_tier.name,
        greatest(v_tier.table_inventory - v_taken, 0)
        using errcode = 'P0001';
    end if;
    v_pledged := v_pledged + v_tier.table_cents * v_tier.wanted;
  end loop;

  insert into public.sponsorships (event_id, sponsor_id, pledged_cents)
  values (p_event_id, p_sponsor_id, v_pledged)
  returning id into v_sponsorship_id;

  for v_tier in
    select (t ->> 'tier_id')::uuid as tier_id, (t ->> 'count')::int as wanted
    from jsonb_array_elements(p_tables) with ordinality as x(t, n)
    order by n
  loop
    insert into public.sponsored_tables (event_id, sponsorship_id, tier_id, invite_token_hash)
    select p_event_id, v_sponsorship_id, v_tier.tier_id, p_token_hashes[v_hash_index + i]
    from generate_series(1, v_tier.wanted) i;
    v_hash_index := v_hash_index + v_tier.wanted;
  end loop;

  select jsonb_build_object(
    'sponsorship', to_jsonb(sp),
    'tables', (select jsonb_agg(jsonb_build_object('id', st.id, 'tier_id', st.tier_id) order by st.created_at, st.id)
               from public.sponsored_tables st where st.sponsorship_id = sp.id))
  into v_after
  from public.sponsorships sp where sp.id = v_sponsorship_id;

  perform public.record_audit_log(
    p_event_id, p_actor_id, p_action, 'sponsorship',
    v_sponsorship_id, null, v_after);

  return jsonb_build_object(
    'sponsorship_id', v_sponsorship_id,
    'pledged_cents', v_pledged);
end;
$$;

revoke execute on function public.create_sponsorship_tables(uuid, uuid, uuid, text, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.create_sponsorship_tables(uuid, uuid, uuid, text, jsonb, text[])
  to service_role;

-- Public pledge (issue #16), now on the shared core. Same signature, same
-- errors, same audit action; grants are kept by create or replace.
create or replace function public.pledge_sponsorship(
  p_user_id uuid,
  p_event_id uuid,
  p_display_name text,
  p_email text,
  p_tables jsonb,
  p_token_hashes text[]
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sponsor_id uuid;
  v_result jsonb;
begin
  perform 1 from public.events e
  where e.id = p_event_id and e.status = 'open';
  if not found then
    raise exception 'pledge_event_closed' using errcode = '55000';
  end if;

  if coalesce(trim(p_display_name), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'pledge_invalid: sponsor name, email and table counts are required'
      using errcode = '22023';
  end if;

  select s.id into v_sponsor_id
  from public.sponsors s
  where s.event_id = p_event_id and s.user_id = p_user_id
  order by s.created_at
  limit 1;
  if v_sponsor_id is null then
    insert into public.sponsors (event_id, user_id, display_name, email)
    values (p_event_id, p_user_id, trim(p_display_name), trim(p_email))
    returning id into v_sponsor_id;
  else
    update public.sponsors
    set display_name = trim(p_display_name), email = trim(p_email)
    where id = v_sponsor_id;
  end if;

  v_result := public.create_sponsorship_tables(
    p_event_id, v_sponsor_id, p_user_id, 'sponsorship.pledge', p_tables, p_token_hashes);

  insert into public.user_roles (user_id, role)
  values (p_user_id, 'sponsor')
  on conflict do nothing;

  return v_result;
end;
$$;

-- Admin pledge: same tables, links and amounts as the public flow. The
-- sponsor is matched by email (any case) within the event, else created with
-- no linked account; no role is granted. The audit row names the admin.
-- Errors: pledge_event_closed 55000 · pledge_invalid 22023 · pledge_inventory P0001.
create function public.admin_pledge_sponsorship(
  p_admin_id uuid,
  p_event_id uuid,
  p_display_name text,
  p_email text,
  p_tables jsonb,
  p_token_hashes text[]
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sponsor_id uuid;
begin
  perform 1 from public.events e
  where e.id = p_event_id and e.status = 'open';
  if not found then
    raise exception 'pledge_event_closed' using errcode = '55000';
  end if;

  if coalesce(trim(p_display_name), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'pledge_invalid: sponsor name, email and table counts are required'
      using errcode = '22023';
  end if;

  select s.id into v_sponsor_id
  from public.sponsors s
  where s.event_id = p_event_id and lower(s.email) = lower(trim(p_email))
  order by s.created_at, s.id
  limit 1;
  if v_sponsor_id is null then
    insert into public.sponsors (event_id, display_name, email)
    values (p_event_id, trim(p_display_name), trim(p_email))
    returning id into v_sponsor_id;
  end if;

  return public.create_sponsorship_tables(
    p_event_id, v_sponsor_id, p_admin_id, 'sponsorship.admin_pledge', p_tables, p_token_hashes);
end;
$$;

revoke execute on function public.admin_pledge_sponsorship(uuid, uuid, text, text, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.admin_pledge_sponsorship(uuid, uuid, text, text, jsonb, text[])
  to service_role;

-- Admin adds guests to any sponsored table in the event, through the same
-- register_sponsored_guests() a guest's invite link uses (no capacity check:
-- a full table takes more guests and shows as overbooked to admins only),
-- then writes the audit row in the same transaction.
-- Errors: admin_guests_table_unknown P0002 · plus register_sponsored_guests'.
create function public.admin_add_sponsored_guests(
  p_admin_id uuid,
  p_event_id uuid,
  p_table_id uuid,
  p_attendees jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hash text;
  v_registration_id uuid;
begin
  select st.invite_token_hash into v_hash
  from public.sponsored_tables st
  where st.id = p_table_id and st.event_id = p_event_id;
  if not found then
    raise exception 'admin_guests_table_unknown' using errcode = 'P0002';
  end if;

  v_registration_id := public.register_sponsored_guests(p_admin_id, v_hash, p_attendees);

  perform public.record_audit_log(
    p_event_id, p_admin_id, 'sponsored_guests.admin_add', 'registration', v_registration_id, null,
    jsonb_build_object(
      'sponsored_table_id', p_table_id,
      'attendees', (select jsonb_agg(jsonb_build_object('id', a.id, 'full_name', a.full_name, 'email', a.email)
                                     order by a.created_at, a.id)
                    from public.attendees a where a.registration_id = v_registration_id)));

  return v_registration_id;
end;
$$;

revoke execute on function public.admin_add_sponsored_guests(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_add_sponsored_guests(uuid, uuid, uuid, jsonb)
  to service_role;
