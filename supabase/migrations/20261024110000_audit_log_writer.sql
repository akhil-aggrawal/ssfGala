-- Shared audit log writer for admin and sponsor edits (issue #22).
-- Additive only. Supabase JS has no client-side transactions, so every edit
-- runs inside a SQL function that changes the row and then calls
-- record_audit_log() in the same statement transaction: if the change rolls
-- back, its audit row rolls back with it.
-- SECURITY INVOKER (the default): it runs with the caller's rights, so the
-- server's service-role client may call it and anon/authenticated may not.

create function public.record_audit_log(
  p_event_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before_data jsonb,
  p_after_data jsonb
) returns bigint
language sql
set search_path = ''
as $$
  insert into public.audit_logs
    (event_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values
    (p_event_id, p_actor_id, p_action, p_entity_type, p_entity_id, p_before_data, p_after_data)
  returning id;
$$;

revoke execute on function public.record_audit_log(uuid, uuid, text, text, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_audit_log(uuid, uuid, text, text, uuid, jsonb, jsonb)
  to service_role;
