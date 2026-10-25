import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { hashInviteToken, inviteUrl, tableInviteToken } from "./pledge";

// Sponsor dashboard: one card per sponsored table the signed-in user owns.
// Reads tables and guests through the visitor's own session client, so RLS
// applies, and filters on their user id as well: RLS alone would show an
// admin every sponsor's tables. Sponsors cannot read payments, so whether a
// guest has paid is read with the service role for those guests only.
// Each table's invite link is rebuilt from its id (tableInviteToken) and shown
// only when it matches the stored hash: links issued before #18 were random
// and cannot be rebuilt.

export type SponsorGuest = { id: string; full_name: string; email: string; paid: boolean };

export type SponsorTableRow = {
  id: string;
  capacity: number;
  created_at: string;
  invite_token_hash: string;
  seating_tiers: { name: string };
  sponsorships: { sponsors: { display_name: string } };
  events: { name: string };
  registrations: {
    status: string;
    attendees: { id: string; full_name: string; email: string; cancelled_at: string | null }[];
  }[];
};

export type TableCard = {
  id: string;
  number: number;
  tier: string;
  capacity: number;
  registered: number;
  guests: SponsorGuest[];
  inviteUrl: string | null;
  sponsorName: string;
  eventName: string;
};

// Oldest table first. Counts every guest not cancelled, past capacity too:
// sponsored tables accept more than 10. paidIds holds the guests with a
// succeeded payment; they cannot be removed.
export function toTableCards(
  rows: readonly SponsorTableRow[],
  paidIds: ReadonlySet<string> = new Set(),
  origin = "",
): TableCard[] {
  return [...rows]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((t, i) => {
      const guests = t.registrations
        .filter((r) => r.status !== "cancelled")
        .flatMap((r) => r.attendees)
        .filter((a) => a.cancelled_at === null)
        .map(({ id, full_name, email }) => ({ id, full_name, email, paid: paidIds.has(id) }));
      const token = tableInviteToken(t.id);
      return {
        id: t.id,
        number: i + 1,
        tier: t.seating_tiers.name,
        capacity: t.capacity,
        registered: guests.length,
        guests,
        inviteUrl: hashInviteToken(token) === t.invite_token_hash ? inviteUrl(origin, token) : null,
        sponsorName: t.sponsorships.sponsors.display_name,
        eventName: t.events.name,
      };
    });
}

export function registeredText(card: Pick<TableCard, "registered" | "capacity">): string {
  return `${card.registered} registered / ${card.capacity} capacity`;
}

// The user's committed tables in the active gala, across all their
// sponsorships. `client` is the visitor's session client; `admin` reads only
// the paid flag of the guests that query returned. `origin` starts each
// invite link. A failed query throws.
export async function loadSponsorTables(
  client: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  userId: string,
  eventId: string,
  origin: string,
): Promise<TableCard[]> {
  const { data, error } = await client
    .from("sponsored_tables")
    .select(
      "id, capacity, created_at, invite_token_hash, seating_tiers!inner(name), events!inner(name), sponsorships!inner(status, sponsors!inner(user_id, display_name)), registrations(status, attendees(id, full_name, email, cancelled_at))",
    )
    .eq("event_id", eventId)
    .eq("sponsorships.status", "committed")
    .eq("sponsorships.sponsors.user_id", userId);
  if (error) throw new Error(`loadSponsorTables failed: ${error.message}`);
  const rows = data as unknown as SponsorTableRow[];
  const ids = rows.flatMap((t) => t.registrations.flatMap((r) => r.attendees.map((a) => a.id)));
  return toTableCards(rows, await loadPaidIds(admin, eventId, ids), origin);
}

async function loadPaidIds(
  admin: SupabaseClient<Database>,
  eventId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from("attendee_payment_status")
    .select("attendee_id")
    .eq("event_id", eventId)
    .eq("paid", true)
    .in("attendee_id", ids);
  if (error) throw new Error(`loadSponsorTables paid status failed: ${error.message}`);
  return new Set(data.map((r) => r.attendee_id).filter((id): id is string => id !== null));
}
