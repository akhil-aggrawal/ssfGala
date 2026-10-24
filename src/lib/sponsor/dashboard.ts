import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Sponsor dashboard: one card per sponsored table the signed-in user owns.
// Read-only. Reads through the visitor's own session client, so RLS applies,
// and filters on their user id as well: RLS alone would show an admin every
// sponsor's tables.

export type SponsorGuest = { full_name: string; email: string };

export type SponsorTableRow = {
  id: string;
  capacity: number;
  created_at: string;
  seating_tiers: { name: string };
  registrations: {
    status: string;
    attendees: (SponsorGuest & { cancelled_at: string | null })[];
  }[];
};

export type TableCard = {
  id: string;
  number: number;
  tier: string;
  capacity: number;
  registered: number;
  guests: SponsorGuest[];
};

// Oldest table first. Counts every guest not cancelled, past capacity too:
// sponsored tables accept more than 10.
export function toTableCards(rows: readonly SponsorTableRow[]): TableCard[] {
  return [...rows]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((t, i) => {
      const guests = t.registrations
        .filter((r) => r.status !== "cancelled")
        .flatMap((r) => r.attendees)
        .filter((a) => a.cancelled_at === null)
        .map(({ full_name, email }) => ({ full_name, email }));
      return {
        id: t.id,
        number: i + 1,
        tier: t.seating_tiers.name,
        capacity: t.capacity,
        registered: guests.length,
        guests,
      };
    });
}

export function registeredText(card: Pick<TableCard, "registered" | "capacity">): string {
  return `${card.registered} registered / ${card.capacity} capacity`;
}

// The user's committed tables in the active gala, across all their
// sponsorships. A failed query throws.
export async function loadSponsorTables(
  client: SupabaseClient<Database>,
  userId: string,
  eventId: string,
): Promise<TableCard[]> {
  const { data, error } = await client
    .from("sponsored_tables")
    .select(
      "id, capacity, created_at, seating_tiers!inner(name), sponsorships!inner(status, sponsors!inner(user_id)), registrations(status, attendees(full_name, email, cancelled_at))",
    )
    .eq("event_id", eventId)
    .eq("sponsorships.status", "committed")
    .eq("sponsorships.sponsors.user_id", userId);
  if (error) throw new Error(`loadSponsorTables failed: ${error.message}`);
  return toTableCards(data as unknown as SponsorTableRow[]);
}
