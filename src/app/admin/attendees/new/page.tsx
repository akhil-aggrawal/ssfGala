import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth/guard";
import { TIER_NAMES } from "@/lib/gala/setup";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { AddAttendeesForm, type TierOption } from "./add-attendees-form";

export const metadata: Metadata = { title: "Add attendees — SSF Gala admin" };

// Tiers and prices come from the active gala in the database.
async function loadTiers(eventId: string): Promise<TierOption[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("seating_tiers")
    .select("id, name, seat_price_cents")
    .eq("event_id", eventId);
  if (error) throw new Error(`add attendees tiers load failed: ${error.message}`);
  const order = (name: string) => (TIER_NAMES as readonly string[]).indexOf(name);
  return data.sort((a, b) => order(a.name) - order(b.name));
}

async function AddAttendees() {
  const access = await requireRole("admin", "/admin/attendees/new");
  if (access.eventId === null) return <p>No active gala is set up yet.</p>;
  return <AddAttendeesForm tiers={await loadTiers(access.eventId)} />;
}

export default function AddAttendeesPage() {
  return (
    <>
      <h1>Add attendees</h1>
      <p>
        Add guests with a complimentary ticket, or guests who already paid by cash or check. No card is charged
        here. <Link href="/admin/attendees">Back to attendees</Link>
      </p>
      <Suspense fallback={<p>Checking access…</p>}>
        <AddAttendees />
      </Suspense>
    </>
  );
}
