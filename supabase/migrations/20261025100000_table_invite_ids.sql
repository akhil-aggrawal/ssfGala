-- Table invite links the server can rebuild (issue #18, owner decision A).
-- The invite token becomes HMAC-SHA256(INVITE_LINK_SECRET, table id), so the
-- server must choose each table's id before the pledge. create_sponsorship_tables()
-- now takes optional table_ids in each p_tables element:
--   p_tables: [{tier_id, count, table_ids?: [uuid × count]}]
-- Without table_ids the database picks the ids, as before. Still only the
-- token hash is stored. Same signature, so grants and the two pledge
-- functions that call it are unchanged. Additive: create or replace only.
-- New error: pledge_invalid 22023 when table_ids are malformed or repeat.

create or replace function public.create_sponsorship_tables(
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

  -- Optional server-made table ids: when a tier sends table_ids, it sends one
  -- distinct uuid per table, and no id repeats across the pledge.
  if exists (
       select 1 from jsonb_array_elements(p_tables) t
       where t ? 'table_ids'
         and (jsonb_typeof(t -> 'table_ids') is distinct from 'array'
              or jsonb_array_length(t -> 'table_ids') <> (t ->> 'count')::int
              or exists (select 1 from jsonb_array_elements(t -> 'table_ids') i
                         where jsonb_typeof(i) is distinct from 'string'
                            or i #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')))
     or (select count(*) - count(distinct i #>> '{}')
         from jsonb_array_elements(p_tables) t, jsonb_array_elements(coalesce(t -> 'table_ids', '[]')) i) <> 0 then
    raise exception 'pledge_invalid: one distinct table id per table is required'
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
    select (t ->> 'tier_id')::uuid as tier_id, (t ->> 'count')::int as wanted,
           t -> 'table_ids' as table_ids
    from jsonb_array_elements(p_tables) with ordinality as x(t, n)
    order by n
  loop
    insert into public.sponsored_tables (id, event_id, sponsorship_id, tier_id, invite_token_hash)
    select coalesce((v_tier.table_ids ->> (i - 1))::uuid, gen_random_uuid()),
           p_event_id, v_sponsorship_id, v_tier.tier_id, p_token_hashes[v_hash_index + i]
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
