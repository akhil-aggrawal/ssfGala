-- Sponsor pledge: one transaction creates (or reuses) the sponsor, one
-- sponsorship, one sponsored table per pledged table, grants the sponsor role
-- and writes the audit_logs row (issue #16).
-- Additive only. SECURITY INVOKER (not definer): only the service role may
-- execute it, and the Next.js server checks sign-in and the active event
-- before calling it.
--
-- p_tables:       [{tier_id, count}] — count >= 1, each tier at most once
-- p_token_hashes: one SHA-256 hex hash per pledged table; the server keeps the
--                 raw tokens for the links and never sends them here.
--
-- Inventory: a tier's remaining tables = table_inventory minus its tables on
-- committed sponsorships. The tier rows are locked first (in a fixed order),
-- so two concurrent pledges cannot both take the last table.
-- Amount: per table, the tier's sponsorship_amount_cents, else 10 seats at
-- seat_price_cents. No payment is taken here.
--
-- Errors (nothing is saved):
--   pledge_event_closed      55000  event missing or not open
--   pledge_invalid           22023  bad tables, counts or hashes
--   pledge_inventory         P0001  a tier has too few tables left

create function public.pledge_sponsorship(
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
  v_tier record;
  v_sponsor_id uuid;
  v_sponsorship_id uuid;
  v_total int := 0;
  v_pledged bigint := 0;
  v_taken int;
  v_hash_index int := 0;
  v_after jsonb;
begin
  perform 1 from public.events e
  where e.id = p_event_id and e.status = 'open';
  if not found then
    raise exception 'pledge_event_closed' using errcode = '55000';
  end if;

  if coalesce(trim(p_display_name), '') = '' or coalesce(trim(p_email), '') = ''
     or jsonb_typeof(p_tables) is distinct from 'array'
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

  insert into public.sponsorships (event_id, sponsor_id, pledged_cents)
  values (p_event_id, v_sponsor_id, v_pledged)
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

  insert into public.user_roles (user_id, role)
  values (p_user_id, 'sponsor')
  on conflict do nothing;

  select jsonb_build_object(
    'sponsorship', to_jsonb(sp),
    'tables', (select jsonb_agg(jsonb_build_object('id', st.id, 'tier_id', st.tier_id) order by st.created_at, st.id)
               from public.sponsored_tables st where st.sponsorship_id = sp.id))
  into v_after
  from public.sponsorships sp where sp.id = v_sponsorship_id;

  perform public.record_audit_log(
    p_event_id, p_user_id, 'sponsorship.pledge', 'sponsorship',
    v_sponsorship_id, null, v_after);

  return jsonb_build_object(
    'sponsorship_id', v_sponsorship_id,
    'pledged_cents', v_pledged);
end;
$$;

revoke execute on function public.pledge_sponsorship(uuid, uuid, text, text, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.pledge_sponsorship(uuid, uuid, text, text, jsonb, text[])
  to service_role;
