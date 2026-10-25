-- Stripe webhook (issue #14): apply one verified Checkout Session event in one
-- transaction. The Next.js route verifies the Stripe signature first and
-- passes only fields from the signed event; this function never sees an
-- unverified request.
-- Additive only. SECURITY INVOKER (not definer): only the service role may
-- execute it, like save_pending_ticket_order.
--
-- Order of work, all or nothing:
--   1. Record the Stripe event id in stripe_webhook_events. Seen before →
--      'duplicate', nothing else runs. An error later rolls this back too, so
--      Stripe's retry is processed again.
--   2. Lock the stored payment for the session. None → 'unknown_session'.
--   3. Only a 'pending' payment changes: a settled one → 'already_settled'
--      (Stripe can send two different events for one session).
--   4. completed / async_payment_succeeded with payment_status 'unpaid'
--      → 'awaiting_payment' (a delayed method; the async event follows).
--   5. Paid amount differs from payments.amount_cents → 'amount_mismatch'
--      with expected_cents; nothing is confirmed. The route logs it.
--   6. Paid → payment 'succeeded', one allocation per live attendee (the
--      amount split evenly, any remainder cent by cent to the first ones),
--      registration 'pending_payment' → 'registered'.
--   7. expired / async_payment_failed → payment 'failed'. The registration
--      stays 'pending_payment' so the buyer can pay again.
--
-- Returns {"outcome": <text>} plus "expected_cents" on amount_mismatch.

create function public.apply_stripe_checkout_event(
  p_event_id text,
  p_event_type text,
  p_session_id text,
  p_payment_status text,
  p_amount_total bigint,
  p_payment_intent_id text default null
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_attendees uuid[];
  v_count int;
  v_share bigint;
  v_extra bigint;
  i int;
begin
  insert into public.stripe_webhook_events (event_id) values (p_event_id)
  on conflict (event_id) do nothing;
  if not found then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  select * into v_payment
  from public.payments p
  where p.stripe_session_id = p_session_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_session');
  end if;

  if v_payment.status <> 'pending' then
    return jsonb_build_object('outcome', 'already_settled');
  end if;

  if p_event_type in ('checkout.session.expired', 'checkout.session.async_payment_failed') then
    update public.payments set status = 'failed' where id = v_payment.id;
    return jsonb_build_object('outcome', 'failed');
  end if;

  if p_event_type not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
    return jsonb_build_object('outcome', 'ignored');
  end if;

  if p_payment_status = 'unpaid' then
    return jsonb_build_object('outcome', 'awaiting_payment');
  end if;

  if p_amount_total is distinct from v_payment.amount_cents then
    return jsonb_build_object('outcome', 'amount_mismatch', 'expected_cents', v_payment.amount_cents);
  end if;

  update public.payments
  set status = 'succeeded',
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
      received_at = now()
  where id = v_payment.id;

  if v_payment.registration_id is not null then
    select coalesce(array_agg(a.id order by a.created_at, a.id), '{}') into v_attendees
    from public.attendees a
    where a.registration_id = v_payment.registration_id and a.cancelled_at is null;
    v_count := coalesce(array_length(v_attendees, 1), 0);

    if v_count > 0 then
      v_share := v_payment.amount_cents / v_count;
      v_extra := v_payment.amount_cents % v_count;
      for i in 1 .. v_count loop
        if v_share + (case when i <= v_extra then 1 else 0 end) > 0 then
          insert into public.payment_allocations (event_id, payment_id, attendee_id, amount_cents)
          values (v_payment.event_id, v_payment.id, v_attendees[i],
                  v_share + (case when i <= v_extra then 1 else 0 end));
        end if;
      end loop;
    end if;

    update public.registrations
    set status = 'registered'
    where id = v_payment.registration_id and status = 'pending_payment';
  end if;

  return jsonb_build_object('outcome', 'confirmed');
end;
$$;

revoke execute on function public.apply_stripe_checkout_event(text, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.apply_stripe_checkout_event(text, text, text, text, bigint, text)
  to service_role;
