import { loadReports } from "@/lib/admin/reports";
import { parseExportFile, reportSheets, toCsv } from "@/lib/admin/exports";
import { requireRole } from "@/lib/auth/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { toXlsx, XLSX_TYPE } from "@/lib/xlsx";

// GET /admin/exports/<report>.csv and /admin/exports/reports.xlsx (FR-10).
// Admins only: requireRole sends a non-admin to the 403 page before any read.
// Every download writes an audit_logs row naming the report; no file is sent
// unless that row is written.
export async function GET(_req: Request, ctx: RouteContext<"/admin/exports/[file]">) {
  const access = await requireRole("admin", "/admin/exports");
  const { file } = await ctx.params;
  const target = parseExportFile(file);
  if (!target) return new Response("Not found", { status: 404 });
  if (access.eventId === null) return new Response("No active gala is set up yet.", { status: 404 });

  const admin = createSupabaseAdminClient();
  const audit = await admin.rpc("record_audit_log", {
    p_event_id: access.eventId,
    p_actor_id: access.user.id,
    p_action: "report.export",
    p_entity_type: "event",
    p_entity_id: access.eventId,
    p_before_data: null,
    p_after_data: { report: target.report, format: target.format, file },
  });
  if (audit.error) throw new Error(`export audit failed: ${audit.error.message}`);

  const sheets = reportSheets(await loadReports(admin, access.eventId));
  const headers = { "Content-Disposition": `attachment; filename="ssf-gala-${file}"`, "Cache-Control": "no-store" };
  if (target.format === "xlsx") {
    return new Response(toXlsx(sheets), { headers: { ...headers, "Content-Type": XLSX_TYPE } });
  }
  const sheet = sheets.find((s) => s.key === target.report)!;
  return new Response(toCsv(sheet.rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}
