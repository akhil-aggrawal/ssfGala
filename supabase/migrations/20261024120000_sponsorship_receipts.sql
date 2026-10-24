-- Offline sponsorship receipts (issue #29): record a check or transfer
-- against a pledge, and correct one without erasing history.
-- Additive only. SECURITY INVOKER (not definer): only the service role may
-- execute them, and the Next.js server checks the admin role and passes the
-- active event before calling them. Each change and its audit_logs row commit
-- in one transaction (record_audit_log, issue #22).
--
-- p_received_on is a calendar date, stored as midnight gala-local (Pacific).
--
-- Errors: unknown sponsorship or receipt in this event 'P0002'; archived
-- event or a receipt that is not a live offline sponsorship receipt '55000';
-- amount out of range '22023'.

create function public.record_sponsorship_receipt(
  p_actor_id uuid,
  p_event_id uuid,
  p_sponsorship_id uuid,
  p_amount_cents bigint,
  p_received_on date
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'receipt_amount: must be more than zero' using errcode = '22023';
  end if;
  if p_received_on is null then
    raise exception 'receipt_date: required' using errcode = '22023';
  end if;
  if (select e.status from public.events e where e.id = p_event_id) = 'archived' then
    raise exception 'receipt_archived' using errcode = '55000';
  end if;
  perform 1 from public.sponsorships s
  where s.id = p_sponsorship_id and s.event_id = p_event_id;
  if not found then
    raise exception 'receipt_sponsorship_not_found' using errcode = 'P0002';
  end if;

  insert into public.payments (
    event_id, sponsorship_id, provider, purpose, amount_cents, status,
    recorded_by, received_at
  ) values (
    p_event_id, p_sponsorship_id, 'offline', 'sponsorship', p_amount_cents, 'succeeded',
    p_actor_id, p_received_on::timestamp at time zone 'America/Los_Angeles'
  )
  returning id into v_id;

  perform public.record_audit_log(
    p_event_id, p_actor_id, 'sponsorship_receipt.create', 'payment', v_id,
    null, (select to_jsonb(p) from public.payments p where p.id = v_id));

  return v_id;
end;
$$;

-- Correcting marks the original 'refunded' (the row and its amount stay) and
-- records the right amount as a new receipt. Amount 0 only voids the
-- original and returns null.
create function public.correct_sponsorship_receipt(
  p_actor_id uuid,
  p_event_id uuid,
  p_payment_id uuid,
  p_amount_cents bigint,
  p_received_on date
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_original public.payments;
  v_new_id uuid;
begin
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'receipt_amount: must not be negative' using errcode = '22023';
  end if;
  if (select e.status from public.events e where e.id = p_event_id) = 'archived' then
    raise exception 'receipt_archived' using errcode = '55000';
  end if;

  select * into v_original
  from public.payments p
  where p.id = p_payment_id and p.event_id = p_event_id
  for update;
  if not found then
    raise exception 'receipt_not_found' using errcode = 'P0002';
  end if;
  if v_original.provider <> 'offline' or v_original.purpose <> 'sponsorship'
     or v_original.status <> 'succeeded' then
    raise exception 'receipt_not_correctable' using errcode = '55000';
  end if;

  update public.payments set status = 'refunded' where id = p_payment_id;

  if p_amount_cents > 0 then
    insert into public.payments (
      event_id, sponsorship_id, provider, purpose, amount_cents, status,
      recorded_by, received_at
    ) values (
      p_event_id, v_original.sponsorship_id, 'offline', 'sponsorship', p_amount_cents,
      'succeeded', p_actor_id,
      coalesce(p_received_on::timestamp at time zone 'America/Los_Angeles',
               v_original.received_at)
    )
    returning id into v_new_id;
  end if;

  perform public.record_audit_log(
    p_event_id, p_actor_id, 'sponsorship_receipt.correct', 'payment', p_payment_id,
    to_jsonb(v_original),
    jsonb_build_object(
      'original', (select to_jsonb(p) from public.payments p where p.id = p_payment_id),
      'replacement', (select to_jsonb(p) from public.payments p where p.id = v_new_id)));

  return v_new_id;
end;
$$;

revoke execute on function public.record_sponsorship_receipt(uuid, uuid, uuid, bigint, date)
  from public, anon, authenticated;
grant execute on function public.record_sponsorship_receipt(uuid, uuid, uuid, bigint, date)
  to service_role;
revoke execute on function public.correct_sponsorship_receipt(uuid, uuid, uuid, bigint, date)
  from public, anon, authenticated;
grant execute on function public.correct_sponsorship_receipt(uuid, uuid, uuid, bigint, date)
  to service_role;
