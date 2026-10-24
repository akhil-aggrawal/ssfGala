-- Invited guest registers attendees on a sponsored table (issue #20): one
-- `sponsored` registration with status `registered` and its attendees, in one
-- transaction. No payment: the sponsor pledged the table. Capacity is never
-- checked here: the 11th guest on a 10-seat table is accepted like the first,
-- and overbooking is shown to admins only, elsewhere.
-- Additive only. SECURITY INVOKER (not definer): only the service role may
-- execute it, and the Next.js server checks the signed-in guest first.
--
-- p_user_id:         the signed-in guest (profiles.id)
-- p_invite_token_hash: sha256 hex of the raw invite token
-- p_attendees:       [{full_name, email}, ...], 1 to 10
--
-- Errors (nothing is saved): bad input 'sponsored_guests_input' (22023);
-- unknown link or cancelled sponsorship 'sponsored_invite_invalid' (P0002);
-- gala not open 'sponsored_invite_closed' (55000).

create function public.register_sponsored_guests(
  p_user_id uuid,
  p_invite_token_hash text,
  p_attendees jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_table record;
  v_registration_id uuid;
  v_attendee jsonb;
begin
  if jsonb_typeof(p_attendees) is distinct from 'array'
     or jsonb_array_length(p_attendees) not between 1 and 10
     or exists (
       select 1 from jsonb_array_elements(p_attendees) a
       where coalesce(btrim(a ->> 'full_name'), '') = ''
          or coalesce(btrim(a ->> 'email'), '') = ''
     ) then
    raise exception 'sponsored_guests_input: 1 to 10 attendees, each with a name and an email'
      using errcode = '22023';
  end if;

  select st.id, st.event_id, st.tier_id, e.status as event_status
  into v_table
  from public.sponsored_tables st
  join public.sponsorships sp on sp.id = st.sponsorship_id
  join public.events e on e.id = st.event_id
  where st.invite_token_hash = p_invite_token_hash
    and sp.status = 'committed'
  for share of st, sp, e;
  if not found then
    raise exception 'sponsored_invite_invalid' using errcode = 'P0002';
  end if;
  if v_table.event_status <> 'open' then
    raise exception 'sponsored_invite_closed' using errcode = '55000';
  end if;

  insert into public.registrations (event_id, created_by, kind, tier_id, sponsored_table_id, status)
  values (v_table.event_id, p_user_id, 'sponsored', v_table.tier_id, v_table.id, 'registered')
  returning id into v_registration_id;

  for v_attendee in select * from jsonb_array_elements(p_attendees) loop
    -- clock_timestamp keeps the entered order within one transaction.
    insert into public.attendees (event_id, registration_id, full_name, email, created_at)
    values (v_table.event_id, v_registration_id, btrim(v_attendee ->> 'full_name'),
            btrim(v_attendee ->> 'email'), clock_timestamp());
  end loop;

  return v_registration_id;
end;
$$;

revoke execute on function public.register_sponsored_guests(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.register_sponsored_guests(uuid, text, jsonb)
  to service_role;
