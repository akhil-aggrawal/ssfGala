-- Row-level security read policies for admins, sponsors and guests.
-- Additive only: RLS is already enabled on every public table; this adds
-- SELECT policies and nothing else. There are no INSERT, UPDATE or DELETE
-- policies, so every client write is refused: the Next.js server writes with
-- the service role (which bypasses RLS) after checking role and event scope.
-- No SECURITY DEFINER functions: each policy reads other tables through the
-- caller's own RLS, so a user only ever sees rows a policy already gave them.
--
-- Who reads what (authenticated sessions only; anon reads nothing):
--   admin   every row of every event (roles are not event-scoped), except
--           other users' user_roles rows and stripe_webhook_events
--   sponsor own sponsors rows, their sponsorships and sponsored_tables, and
--           the registrations and attendees on those tables
--   guest   registrations they created, those attendees, those payments
--   anyone  their own profile and roles; non-draft events and their tiers

-- True when the caller holds the admin role. Security invoker: it reads
-- user_roles through the policy below, which shows the caller's own rows.
create function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Own rows only. An admin-reads-all policy here would recurse through
-- is_admin(); admins manage roles through the server.
create policy user_roles_select_own on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy events_select on public.events
  for select to authenticated
  using (status <> 'draft' or (select public.is_admin()));

-- A tier is visible when its event is (events policy above).
create policy seating_tiers_select on public.seating_tiers
  for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id));

create policy sponsors_select on public.sponsors
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Visible when its sponsor is (sponsors policy above).
create policy sponsorships_select on public.sponsorships
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.sponsors s where s.id = sponsor_id)
  );

-- Visible when its sponsorship is (sponsorships policy above).
create policy sponsored_tables_select on public.sponsored_tables
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.sponsorships sp where sp.id = sponsorship_id)
  );

-- The creator, the sponsor whose table it is on, or an admin. An admin sees
-- every sponsor's tables, so the table check also covers admins; is_admin()
-- stays first so their check is one lookup.
create policy registrations_select on public.registrations
  for select to authenticated
  using (
    (select public.is_admin())
    or created_by = (select auth.uid())
    or exists (
      select 1 from public.sponsored_tables t where t.id = sponsored_table_id
    )
  );

-- Visible when its registration is (registrations policy above).
create policy attendees_select on public.attendees
  for select to authenticated
  using (
    exists (select 1 from public.registrations r where r.id = registration_id)
  );

-- Admins, and the guest who made the registration it pays for. Sponsors do
-- not see their guests' payments.
create policy payments_select on public.payments
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.registrations r
      where r.id = registration_id and r.created_by = (select auth.uid())
    )
  );

-- Visible when its payment is (payments policy above).
create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id));

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using ((select public.is_admin()));

-- stripe_webhook_events: no policy. Only the webhook handler (service role)
-- reads or writes it.

-- Money and trust tables: take the client write grants away too, so a
-- future write policy added by mistake still cannot open them.
revoke insert, update, delete, truncate
  on public.payments, public.payment_allocations, public.user_roles,
     public.stripe_webhook_events, public.audit_logs
  from anon, authenticated;
