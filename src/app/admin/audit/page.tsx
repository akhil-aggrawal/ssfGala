import type { Metadata } from "next";
import { Suspense } from "react";
import { listRecentAuditLogs, AUDIT_PAGE_SIZE, type AuditEntry } from "@/lib/audit";
import { requireRole } from "@/lib/auth/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log — SSF Gala admin" };

const when = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Los_Angeles",
});

const json = (value: unknown) => (value == null ? "—" : JSON.stringify(value));

function actorName(entry: AuditEntry) {
  return entry.actor?.display_name || entry.actor?.email || "system";
}

async function AuditList() {
  const access = await requireRole("admin", "/admin/audit");
  if (access.eventId === null) return <p>No active gala is set up yet.</p>;

  const entries = await listRecentAuditLogs(createSupabaseAdminClient(), access.eventId);
  if (entries.length === 0) return <p>No audit entries yet.</p>;

  return (
    // Focusable so keyboard users can scroll the wide table on a phone.
    <div className="admin-table-wrap" role="region" aria-label="Audit log entries" tabIndex={0}>
      <table className="admin-table">
        <caption>Newest {AUDIT_PAGE_SIZE} changes for the active gala</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">Action</th>
            <th scope="col">Entity</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <time dateTime={entry.created_at}>{when.format(new Date(entry.created_at))}</time>
              </td>
              <td>{actorName(entry)}</td>
              <td>{entry.action}</td>
              <td>
                {entry.entity_type}
                {entry.entity_id && <code className="admin-id">{entry.entity_id}</code>}
              </td>
              <td><code>{json(entry.before_data)}</code></td>
              <td><code>{json(entry.after_data)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditPage() {
  return (
    <>
      <h1>Audit log</h1>
      <Suspense fallback={<p>Checking access…</p>}>
        <AuditList />
      </Suspense>
    </>
  );
}
