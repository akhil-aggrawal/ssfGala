-- Ticket buyer saves attendee details before payment (issue #12): one
-- `individual` registration with status `pending_payment` per buyer, and its
-- attendees, in one transaction. A resubmit (back and edit) updates that same
-- registration: attendees are edited in place by position, extra ones are
-- added, and surplus ones are soft-cancelled (`cancelled_at`), never deleted.
-- Additive only. SECURITY INVOKER (not definer): only the service role may
-- execute it, and the Next.js server checks the signed-in buyer first.
-- No money moves here; the price is read from the tier at payment time.
--
-- p_user_id:   the signed-in buyer (profiles.id)
-- p_tier_name: a tier of the open gala, e.g. 'Gold'
-- p_attendees: [{full_name, email}, ...], 1 to 10
--
-- Errors (nothing is saved): bad input or unknown tier
-- 'ticket_order_input' (22023); no gala open for sales 'ticket_order_closed'
-- (55000).

create function public.save_pending_ticket_order(
  p_user_id uuid,
  p_tier_name text,
  p_attendees jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_tier_id uuid;
  v_count int;
  v_registration_id uuid;
  v_existing uuid[];
  v_kept int;
  v_attendee jsonb;
  i int;
begin
  if jsonb_typeof(p_attendees) is distinct from 'array'
     or jsonb_array_length(p_attendees) not between 1 and 10
     or exists (
       select 1 from jsonb_array_elements(p_attendees) a
       where coalesce(btrim(a ->> 'full_name'), '') = ''
          or coalesce(btrim(a ->> 'email'), '') = ''
     ) then
    raise exception 'ticket_order_input: 1 to 10 attendees, each with a name and an email'
      using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_attendees);

  select e.id into v_event_id
  from public.events e
  where e.status = 'open'
  for share;
  if not found then
    raise exception 'ticket_order_closed' using errcode = '55000';
  end if;

  select t.id into v_tier_id
  from public.seating_tiers t
  where t.event_id = v_event_id and t.name = p_tier_name;
  if not found then
    raise exception 'ticket_order_input: unknown tier' using errcode = '22023';
  end if;

  -- One buyer's submits run one at a time, so a double click never makes two orders.
  perform 1 from public.profiles p where p.id = p_user_id for update;

  select r.id into v_registration_id
  from public.registrations r
  where r.event_id = v_event_id
    and r.created_by = p_user_id
    and r.kind = 'individual'
    and r.status = 'pending_payment'
  order by r.created_at desc
  limit 1
  for update;

  if v_registration_id is null then
    insert into public.registrations (event_id, created_by, kind, tier_id, status)
    values (v_event_id, p_user_id, 'individual', v_tier_id, 'pending_payment')
    returning id into v_registration_id;
  else
    update public.registrations set tier_id = v_tier_id where id = v_registration_id;
  end if;

  select coalesce(array_agg(a.id order by a.created_at, a.id), '{}') into v_existing
  from public.attendees a
  where a.registration_id = v_registration_id and a.cancelled_at is null;
  v_kept := least(coalesce(array_length(v_existing, 1), 0), v_count);

  for i in 1 .. v_count loop
    v_attendee := p_attendees -> (i - 1);
    if i <= v_kept then
      update public.attendees
      set full_name = btrim(v_attendee ->> 'full_name'), email = btrim(v_attendee ->> 'email')
      where id = v_existing[i];
    else
      -- clock_timestamp keeps the entered order within one transaction.
      insert into public.attendees (event_id, registration_id, full_name, email, created_at)
      values (v_event_id, v_registration_id, btrim(v_attendee ->> 'full_name'),
              btrim(v_attendee ->> 'email'), clock_timestamp());
    end if;
  end loop;

  update public.attendees
  set cancelled_at = now()
  where id = any (v_existing[v_kept + 1 :]);

  return v_registration_id;
end;
$$;

revoke execute on function public.save_pending_ticket_order(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_pending_ticket_order(uuid, text, jsonb)
  to service_role;
