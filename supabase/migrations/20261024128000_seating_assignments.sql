-- Seating (issue #28): set a sponsored table's physical number, and move one
-- guest to another table, each with its audit_logs row in one transaction.
-- Additive only. SECURITY INVOKER: only the service role may execute them,
-- and the Next.js server checks the admin role before calling them.
--
-- A guest's table is attendees.assigned_table_number when set, otherwise
-- their sponsored table's physical_table_number. An empty or blank number
-- clears the value.
--
-- Errors: a row outside p_event_id (or a cancelled guest) raises
-- 'seating_not_found' (P0002); an archived event raises
-- 'seating_archived' (55000).

create function public.seating_check_event(p_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select e.status into v_status from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'seating_not_found' using errcode = 'P0002';
  end if;
  if v_status = 'archived' then
    raise exception 'seating_archived' using errcode = '55000';
  end if;
end;
$$;

create function public.set_table_number(
  p_actor_id uuid,
  p_event_id uuid,
  p_table_id uuid,
  p_number text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_before text;
  v_after text := nullif(btrim(p_number), '');
begin
  perform public.seating_check_event(p_event_id);

  select t.physical_table_number into v_before
  from public.sponsored_tables t
  where t.id = p_table_id and t.event_id = p_event_id
  for update;
  if not found then
    raise exception 'seating_not_found' using errcode = 'P0002';
  end if;

  update public.sponsored_tables
  set physical_table_number = v_after
  where id = p_table_id;

  perform public.record_audit_log(
    p_event_id, p_actor_id, 'table.assign_number', 'sponsored_table', p_table_id,
    jsonb_build_object('physical_table_number', v_before),
    jsonb_build_object('physical_table_number', v_after)
  );
end;
$$;

create function public.move_attendee(
  p_actor_id uuid,
  p_event_id uuid,
  p_attendee_id uuid,
  p_number text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_before text;
  v_after text := nullif(btrim(p_number), '');
begin
  perform public.seating_check_event(p_event_id);

  select a.assigned_table_number into v_before
  from public.attendees a
  where a.id = p_attendee_id and a.event_id = p_event_id and a.cancelled_at is null
  for update;
  if not found then
    raise exception 'seating_not_found' using errcode = 'P0002';
  end if;

  update public.attendees
  set assigned_table_number = v_after
  where id = p_attendee_id;

  perform public.record_audit_log(
    p_event_id, p_actor_id, 'attendee.move', 'attendee', p_attendee_id,
    jsonb_build_object('assigned_table_number', v_before),
    jsonb_build_object('assigned_table_number', v_after)
  );
end;
$$;

revoke execute on function public.seating_check_event(uuid)
  from public, anon, authenticated;
revoke execute on function public.set_table_number(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.move_attendee(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.seating_check_event(uuid) to service_role;
grant execute on function public.set_table_number(uuid, uuid, uuid, text) to service_role;
grant execute on function public.move_attendee(uuid, uuid, uuid, text) to service_role;
