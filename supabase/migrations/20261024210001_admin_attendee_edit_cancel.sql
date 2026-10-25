-- Admin attendee corrections and soft-cancel (issue #26).
-- Additive only. Each function changes one attendee and writes its audit row
-- through record_audit_log() in the same transaction. SECURITY INVOKER (the
-- default): only the service role may execute them, and the Next.js server
-- checks the admin role and passes the caller's active event before calling.
-- Cancel never deletes: it sets cancelled_at, and payments and allocations
-- are left as they are.
--
-- Errors: blank name/email 22023 · attendee not in this event P0002 ·
-- archived or missing event 55000 · already cancelled P0001
-- 'attendee_already_cancelled'.

create function public.admin_update_attendee(
  p_actor_id uuid,
  p_event_id uuid,
  p_attendee_id uuid,
  p_full_name text,
  p_email text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if nullif(btrim(p_full_name), '') is null or nullif(btrim(p_email), '') is null then
    raise exception 'attendee_name_email_required' using errcode = '22023';
  end if;

  perform 1 from public.events e where e.id = p_event_id and e.status <> 'archived';
  if not found then
    raise exception 'attendee_event_read_only' using errcode = '55000';
  end if;

  select to_jsonb(a) into v_before
  from public.attendees a
  where a.id = p_attendee_id and a.event_id = p_event_id
  for update;
  if v_before is null then
    raise exception 'attendee_not_found' using errcode = 'P0002';
  end if;

  update public.attendees a
  set full_name = btrim(p_full_name),
      email = btrim(p_email)
  where a.id = p_attendee_id
  returning to_jsonb(a) into v_after;

  perform public.record_audit_log(
    p_event_id, p_actor_id, 'attendee.update', 'attendee', p_attendee_id, v_before, v_after);
end;
$$;

create function public.admin_cancel_attendee(
  p_actor_id uuid,
  p_event_id uuid,
  p_attendee_id uuid
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform 1 from public.events e where e.id = p_event_id and e.status <> 'archived';
  if not found then
    raise exception 'attendee_event_read_only' using errcode = '55000';
  end if;

  select to_jsonb(a) into v_before
  from public.attendees a
  where a.id = p_attendee_id and a.event_id = p_event_id
  for update;
  if v_before is null then
    raise exception 'attendee_not_found' using errcode = 'P0002';
  end if;
  if v_before ->> 'cancelled_at' is not null then
    raise exception 'attendee_already_cancelled';
  end if;

  update public.attendees a
  set cancelled_at = now()
  where a.id = p_attendee_id
  returning to_jsonb(a) into v_after;

  perform public.record_audit_log(
    p_event_id, p_actor_id, 'attendee.cancel', 'attendee', p_attendee_id, v_before, v_after);
end;
$$;

revoke execute on function public.admin_update_attendee(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_attendee(uuid, uuid, uuid, text, text)
  to service_role;
revoke execute on function public.admin_cancel_attendee(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_cancel_attendee(uuid, uuid, uuid)
  to service_role;
