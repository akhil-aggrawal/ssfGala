import type { Metadata } from "next";
import { Suspense } from "react";
import { formatCents, loadOverview } from "@/lib/admin/overview";
import { requireRole } from "@/lib/auth/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Overview — SSF Gala admin" };

async function Overview() {
  const access = await requireRole("admin", "/admin");
  const signedIn = <p>Signed in as {access.user.email ?? "admin"}.</p>;
  if (access.eventId === null) {
    return (
      <>
        {signedIn}
        <p>No active gala is set up yet.</p>
      </>
    );
  }
  const o = await loadOverview(createSupabaseAdminClient(), access.eventId);
  const metrics = [
    { label: "Attendees", value: o.attendeeCount.toLocaleString("en-US") },
    { label: "Stripe collected", value: formatCents(o.stripeCollectedCents) },
    { label: "Offline receipts", value: formatCents(o.offlineReceiptsCents) },
    { label: "Outstanding sponsorship", value: formatCents(o.outstandingSponsorshipCents) },
    { label: "Overbooked tables", value: o.overbookedTables.toLocaleString("en-US") },
  ];
  return (
    <>
      {signedIn}
      <dl className="admin-metrics">
        {metrics.map((m) => (
          <div key={m.label} className="admin-metric">
            <dt>{m.label}</dt>
            <dd>{m.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export default function AdminOverviewPage() {
  return (
    <>
      <h1>Overview</h1>
      <Suspense fallback={<p>Checking access…</p>}>
        <Overview />
      </Suspense>
    </>
  );
}
