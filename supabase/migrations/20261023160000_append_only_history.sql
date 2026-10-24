-- Append-only financial history (issue #55).
-- audit_logs rejects UPDATE, DELETE and TRUNCATE. payments and
-- payment_allocations reject DELETE and TRUNCATE; status changes stay allowed.
-- Triggers fire for every role, including the service role and the table owner.
-- Additive only: no data changes. The function is SECURITY INVOKER.

create function public.reject_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% on % is not allowed: history is append-only', tg_op, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.reject_history_change();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function public.reject_history_change();

create trigger payments_no_delete
  before delete on public.payments
  for each row execute function public.reject_history_change();

create trigger payments_no_truncate
  before truncate on public.payments
  for each statement execute function public.reject_history_change();

create trigger payment_allocations_no_delete
  before delete on public.payment_allocations
  for each row execute function public.reject_history_change();

create trigger payment_allocations_no_truncate
  before truncate on public.payment_allocations
  for each statement execute function public.reject_history_change();
