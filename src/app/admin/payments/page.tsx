import type { Metadata } from "next";
import { Suspense } from "react";
import { loadSponsorshipBalances } from "@/lib/admin/receipts";
import { requireRole } from "@/lib/auth/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { Balances } from "./balances";

export const metadata: Metadata = { title: "Payments — SSF Gala admin" };

async function Payments() {
  const access = await requireRole("admin", "/admin/payments");
  if (access.eventId === null) return <p>No active gala is set up yet.</p>;
  const balances = await loadSponsorshipBalances(createSupabaseAdminClient(), access.eventId);
  return <Balances balances={balances} />;
}

export default function PaymentsPage() {
  return (
    <>
      <h1>Payments</h1>
      <p>Record sponsorship checks and transfers received offline, including partial amounts.</p>
      <Suspense fallback={<p>Checking access…</p>}>
        <Payments />
      </Suspense>
    </>
  );
}
