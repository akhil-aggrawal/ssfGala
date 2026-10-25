import type { Metadata } from "next";
import { Suspense } from "react";
import { loadReports } from "@/lib/admin/reports";
import { requireRole } from "@/lib/auth/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = { title: "Reports — SSF Gala admin" };

async function Reports() {
  const access = await requireRole("admin", "/admin/reports");
  if (access.eventId === null) return <p>No active gala is set up yet.</p>;
  const reports = await loadReports(createSupabaseAdminClient(), access.eventId);
  return <ReportsView reports={reports} />;
}

export default function ReportsPage() {
  return (
    <>
      <h1>Reports</h1>
      <p>Totals count active attendees and received payments only. Cancelled attendees and failed payments are left out.</p>
      <Suspense fallback={<p>Checking access…</p>}>
        <Reports />
      </Suspense>
    </>
  );
}
