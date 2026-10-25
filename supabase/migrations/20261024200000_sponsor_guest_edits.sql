-- Sponsors edit their guests and remove only unpaid ones (issue #23).
-- Each function checks that the guest sits on a committed table the sponsor
-- owns in p_event_id, changes the row, and writes its audit_logs row, all in
-- one transaction. Removal is a soft-cancel (cancelled_at); a paid guest is
-- refused here, so the rule holds for every caller.
-- Additive only. SECURITY INVOKER (not definer), like the other write
-- functions: only the service role may execute them, so a direct API call
-- from a browser session is refused, and the Next.js server checks the
-- signed-in sponsor first.
--
-- Errors (nothing is saved): blank name or email 'sponsor_guest_input'
-- (22023); a guest not on the sponsor's table in that gala, or already
-- removed, 'sponsor_guest_not_found' (P0002); archived gala
-- 'sponsor_guest_archived' (55000); paid guest 'sponsor_guest_paid' (P0001).

-- Locks and returns the sponsor's active guest. Internal helper.
create function public.sponsor_lock_guest(
  p_user_id uuid,
  p_event_id uuid,
  p_attendee_id uuid
) returns public.attendees
language plpgsql
set search_path = ''
as $$
declare
  v_guest public.attendees;
  v_event_status text;
begin
  select a.* into v_guest
  from public.attendees a
  join public.registrations r on r.id = a.registration_id
  join public.sponsored_tables st on st.id = r.sponsored_table_id
  join public.sponsorships sp on sp.id = st.sponsorship_id
  join public.sponsors s on s.id = sp.sponsor_id
  where a.id = p_attendee_id
    and a.event_id = p_event_id
    and a.cancelled_at is null
    and r.kind = 'sponsored'
    and r.status <> 'cancelled'
    and sp.status = 'committed'
    and s.user_id = p_user_id
  for update of a;
  if not found then
    raise exception 'sponsor_guest_not_found' using errcode = 'P0002';
  end if;
  select e.status into v_event_status from public.events e where e.id = p_event_id;
  if v_event_status = 'archived' then
    raise exception 'sponsor_guest_archived' using errcode = '55000';
  end if;
  return v_guest;
end;
$$;

create function public.sponsor_update_guest(
  p_user_id uuid,
  p_event_id uuid,
  p_attendee_id uuid,
  p_full_name text,
  p_email text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_before public.attendees;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
begin
  if v_name = '' or v_email = '' then
    raise exception 'sponsor_guest_input: a guest needs a name and an email'
      using errcode = '22023';
  end if;

  v_before := public.sponsor_lock_guest(p_user_id, p_event_id, p_attendee_id);

  update public.attendees
  set full_name = v_name, email = v_email
  where id = p_attendee_id;

  perform public.record_audit_log(
    p_event_id, p_user_id, 'attendee.update', 'attendee', p_attendee_id,
    jsonb_build_object('full_name', v_before.full_name, 'email', v_before.email),
    jsonb_build_object('full_name', v_name, 'email', v_email)
  );
end;
$$;

create function public.sponsor_remove_guest(
  p_user_id uuid,
  p_event_id uuid,
  p_attendee_id uuid
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_before public.attendees;
  v_now timestamptz := now();
begin
  -- The attendee row lock blocks a new allocation for this guest (its
  -- foreign key needs a share lock); the payment lock below holds a pending
  -- payment's status until this transaction ends.
  v_before := public.sponsor_lock_guest(p_user_id, p_event_id, p_attendee_id);

  perform 1
  from public.payment_allocations pa
  join public.payments p on p.id = pa.payment_id
  where pa.attendee_id = p_attendee_id
  for share of p;

  if exists (
    select 1
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.attendee_id = p_attendee_id
      and p.status = 'succeeded'
  ) then
    raise exception 'sponsor_guest_paid' using errcode = 'P0001';
  end if;

  update public.attendees
  set cancelled_at = v_now
  where id = p_attendee_id;

  perform public.record_audit_log(
    p_event_id, p_user_id, 'attendee.cancel', 'attendee', p_attendee_id,
    jsonb_build_object('full_name', v_before.full_name, 'email', v_before.email, 'cancelled_at', null),
    jsonb_build_object('full_name', v_before.full_name, 'email', v_before.email, 'cancelled_at', v_now)
  );
end;
$$;

revoke execute on function public.sponsor_lock_guest(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.sponsor_update_guest(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.sponsor_remove_guest(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.sponsor_lock_guest(uuid, uuid, uuid) to service_role;
grant execute on function public.sponsor_update_guest(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.sponsor_remove_guest(uuid, uuid, uuid) to service_role;
