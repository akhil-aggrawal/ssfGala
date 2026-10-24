import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccess } from "@/lib/auth/guard";
import { formatUsd, loadPledgeTiers, tableCents } from "@/lib/sponsor/pledge";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { PledgeForm } from "./pledge-form";

export const metadata: Metadata = { title: "Sponsor a Table — SSF Gala" };

async function Pledge() {
  const access = await getAccess();
  if (!access) redirect("/signin?next=%2Fsponsor");
  if (!access.eventId) {
    return <p className="pledge__note">Table pledges are not open yet. Please check back soon.</p>;
  }
  const tiers = await loadPledgeTiers(createSupabaseAdminClient(), access.eventId);
  return (
    <PledgeForm
      email={access.user.email ?? ""}
      tiers={tiers.map((t) => ({
        name: t.name,
        price: formatUsd(tableCents(t)),
        table_cents: tableCents(t),
        tables_left: t.tables_left,
      }))}
    />
  );
}

export default function SponsorPage() {
  return (
    <main className="pledge">
      <h1>Sponsor a Table</h1>
      <p className="pledge__lede">
        Each table seats 10 guests. Pledge now; you will get one invite link per table to share with your guests.
        Payment is collected offline.
      </p>
      <Suspense>
        <Pledge />
      </Suspense>
    </main>
  );
}
