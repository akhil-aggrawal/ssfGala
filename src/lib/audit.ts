import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Audit trail for admin and sponsor edits.
//
// Writing: Supabase JS has no client-side transactions, so an audited edit
// is a SQL function that changes the row and then calls
//   public.record_audit_log(event_id, actor_id, action, entity_type,
//                           entity_id, before_data, after_data)
// in the same transaction (migration 20261023160000_audit_log_writer.sql).
// If the edit rolls back, its audit row rolls back too. Never write the
// audit row in a separate request after the edit.
//
// Reading: listRecentAuditLogs below, for /admin/audit.

export const AUDIT_PAGE_SIZE = 100;

const AUDIT_COLUMNS =
  "id, created_at, action, entity_type, entity_id, before_data, after_data, actor:profiles(email, display_name)";

// Newest entries first for one event. Takes the service-role client: RLS has
// no policies yet. A failed query throws, so a DB error never reads as "no
// history".
export async function listRecentAuditLogs(admin: SupabaseClient<Database>, eventId: string) {
  const { data, error } = await admin
    .from("audit_logs")
    .select(AUDIT_COLUMNS)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AUDIT_PAGE_SIZE);
  if (error) throw new Error(`listRecentAuditLogs failed: ${error.message}`);
  return data ?? [];
}

export type AuditEntry = Awaited<ReturnType<typeof listRecentAuditLogs>>[number];
