-- save_gala_setup() writes its audit row through record_audit_log() (issue #64),
-- so the audit row shape lives in one place. No behaviour change.
-- Same signature, so CREATE OR REPLACE keeps the existing grants; they are
-- restated below. Additive only. SECURITY INVOKER, as before.

create or replace function public.save_gala_setup(
  p_actor_id uuid,
  p_event jsonb,
  p_tiers jsonb,
  p_event_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_status text;
  v_before jsonb;
  v_after jsonb;
  v_date timestamptz :=
    (nullif(p_event ->> 'date_local', '')::timestamp) at time zone 'America/Los_Angeles';
begin
  if jsonb_typeof(p_tiers) is distinct from 'array'
     or jsonb_array_length(p_tiers) <> 3
     or (select count(distinct t ->> 'name')
         from jsonb_array_elements(p_tiers) t
         where t ->> 'name' in ('Silver', 'Gold', 'Platinum')) <> 3 then
    raise exception 'gala_setup_tiers: exactly Silver, Gold and Platinum are required'
      using errcode = '22023';
  end if;

  if p_event_id is null then
    insert into public.events (name, year, date_at, venue, status)
    values (
      p_event ->> 'name',
      (p_event ->> 'year')::int,
      v_date,
      nullif(p_event ->> 'venue', ''),
      p_event ->> 'status'
    )
    returning id into v_event_id;
  else
    select e.status into v_status
    from public.events e
    where e.id = p_event_id
    for update;
    if not found then
      raise exception 'gala_setup_not_found' using errcode = 'P0002';
    end if;
    if v_status = 'archived' then
      raise exception 'gala_setup_archived' using errcode = '55000';
    end if;

    v_event_id := p_event_id;
    select jsonb_build_object(
      'event', to_jsonb(e),
      'tiers', (select jsonb_agg(to_jsonb(s) order by s.name)
                from public.seating_tiers s where s.event_id = e.id))
    into v_before
    from public.events e where e.id = v_event_id;

    update public.events
    set name = p_event ->> 'name',
        year = (p_event ->> 'year')::int,
        date_at = v_date,
        venue = nullif(p_event ->> 'venue', ''),
        status = p_event ->> 'status'
    where id = v_event_id;
  end if;

  insert into public.seating_tiers (
    event_id, name, seat_price_cents, suggested_contribution_cents,
    sponsorship_amount_cents, table_inventory
  )
  select
    v_event_id,
    t ->> 'name',
    (t ->> 'seat_price_cents')::bigint,
    (t ->> 'suggested_contribution_cents')::bigint,
    (t ->> 'sponsorship_amount_cents')::bigint,
    (t ->> 'table_inventory')::int
  from jsonb_array_elements(p_tiers) t
  on conflict (event_id, name) do update
  set seat_price_cents = excluded.seat_price_cents,
      suggested_contribution_cents = excluded.suggested_contribution_cents,
      sponsorship_amount_cents = excluded.sponsorship_amount_cents,
      table_inventory = excluded.table_inventory;

  select jsonb_build_object(
    'event', to_jsonb(e),
    'tiers', (select jsonb_agg(to_jsonb(s) order by s.name)
              from public.seating_tiers s where s.event_id = e.id))
  into v_after
  from public.events e where e.id = v_event_id;

  perform public.record_audit_log(
    v_event_id,
    p_actor_id,
    case when p_event_id is null then 'gala_setup.create' else 'gala_setup.update' end,
    'event',
    v_event_id,
    v_before,
    v_after
  );

  return v_event_id;
end;
$$;

revoke execute on function public.save_gala_setup(uuid, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.save_gala_setup(uuid, jsonb, jsonb, uuid)
  to service_role;
