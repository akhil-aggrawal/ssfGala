-- Admin adds complimentary or offline-paid attendees (issue #25): the
-- registration, its attendees, the offline payment and allocations (paid
-- offline only) and the audit_logs row, in one transaction.
-- Additive only. SECURITY INVOKER (not definer): only the service role may
-- execute it, and the Next.js server checks the admin role and the active
-- event before calling it. No Stripe: an offline payment is recorded money
-- the foundation already received, never a charge.
--
-- p_kind:         'complimentary' or 'offline_paid'
-- p_attendees:    [{full_name, email}, ...] (at least one)
-- p_amount_cents: offline_paid only, > 0 and at least 1 cent per attendee;
--                 must be null for complimentary.
-- Allocations split the amount evenly in whole cents; the first attendees
-- take the leftover cents, so allocations always sum to the payment.
--
-- Errors (nothing is saved): bad input 'admin_attendees_input' (22023);
-- unknown event 'admin_attendees_not_found' (P0002); archived event
-- 'admin_attendees_archived' (55000); a tier from another event fails the
-- registrations (tier_id, event_id) foreign key (23503).

create function public.add_admin_attendees(
  p_actor_id uuid,
  p_event_id uuid,
  p_kind text,
  p_tier_id uuid,
  p_attendees jsonb,
  p_amount_cents bigint default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_count int;
  v_registration_id uuid;
  v_payment_id uuid;
  v_attendee jsonb;
  v_attendee_id uuid;
  v_attendee_ids uuid[] := '{}';
begin
  if p_kind is distinct from 'complimentary' and p_kind is distinct from 'offline_paid' then
    raise exception 'admin_attendees_input: kind must be complimentary or offline_paid'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_attendees) is distinct from 'array'
     or jsonb_array_length(p_attendees) = 0
     or exists (
       select 1 from jsonb_array_elements(p_attendees) a
       where coalesce(btrim(a ->> 'full_name'), '') = ''
          or coalesce(btrim(a ->> 'email'), '') = ''
     ) then
    raise exception 'admin_attendees_input: every attendee needs a name and an email'
      using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_attendees);

  if p_kind = 'complimentary' and p_amount_cents is not null then
    raise exception 'admin_attendees_input: a complimentary registration has no payment'
      using errcode = '22023';
  end if;
  if p_kind = 'offline_paid' and (p_amount_cents is null or p_amount_cents < v_count) then
    raise exception 'admin_attendees_input: an offline payment needs at least 1 cent per attendee'
      using errcode = '22023';
  end if;

  select e.status into v_status
  from public.events e
  where e.id = p_event_id
  for share;
  if not found then
    raise exception 'admin_attendees_not_found' using errcode = 'P0002';
  end if;
  if v_status = 'archived' then
    raise exception 'admin_attendees_archived' using errcode = '55000';
  end if;

  insert into public.registrations (event_id, created_by, kind, tier_id, status)
  values (p_event_id, p_actor_id, p_kind, p_tier_id, 'registered')
  returning id into v_registration_id;

  -- One insert per attendee keeps the entered order for the allocations.
  for v_attendee in select a from jsonb_array_elements(p_attendees) a loop
    insert into public.attendees (event_id, registration_id, full_name, email)
    values (p_event_id, v_registration_id, btrim(v_attendee ->> 'full_name'), btrim(v_attendee ->> 'email'))
    returning id into v_attendee_id;
    v_attendee_ids := v_attendee_ids || v_attendee_id;
  end loop;

  if p_kind = 'offline_paid' then
    insert into public.payments (
      event_id, registration_id, provider, purpose, amount_cents, status,
      recorded_by, received_at
    ) values (
      p_event_id, v_registration_id, 'offline', 'ticket', p_amount_cents, 'succeeded',
      p_actor_id, now()
    )
    returning id into v_payment_id;

    insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents)
    select
      p_event_id,
      v_payment_id,
      v_attendee_ids[i],
      p_amount_cents / v_count + case when i <= p_amount_cents % v_count then 1 else 0 end
    from generate_series(1, v_count) as i;
  end if;

  perform public.record_audit_log(
    p_event_id,
    p_actor_id,
    'registration.create_' || p_kind,
    'registration',
    v_registration_id,
    null,
    jsonb_build_object(
      'registration', (select to_jsonb(r) from public.registrations r where r.id = v_registration_id),
      'attendees', (select jsonb_agg(to_jsonb(a) order by a.created_at, a.id)
                    from public.attendees a where a.registration_id = v_registration_id),
      'payment', (select to_jsonb(p) from public.payments p where p.id = v_payment_id),
      'allocations', (select jsonb_agg(to_jsonb(pa) order by pa.id)
                      from public.payment_allocations pa where pa.payment_id = v_payment_id)
    )
  );

  return v_registration_id;
end;
$$;

revoke execute on function public.add_admin_attendees(uuid, uuid, text, uuid, jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.add_admin_attendees(uuid, uuid, text, uuid, jsonb, bigint)
  to service_role;
