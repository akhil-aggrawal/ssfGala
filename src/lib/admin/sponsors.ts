import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { parseAttendees, type AttendeeInput } from "@/lib/tickets/order";
import { readAll } from "./overview";
import { loadSeating, type SeatingTable } from "./seating";

// Sponsors (/admin/sponsors): every sponsor with their pledged total, their
// live tables and each table's guests. Admin only: the overbooked flag is
// never shown to guests or sponsors. Amounts are integer USD cents.

type Tables = Database["public"]["Tables"];
type Row<T extends keyof Tables, K extends keyof Tables[T]["Row"]> = Pick<Tables[T]["Row"], K>;

export type SponsorSummary = {
  id: string;
  name: string;
  email: string;
  pledgedCents: number;
  tableCount: number;
  tables: SeatingTable[];
};

// Totals count committed sponsorships only; their live tables come from
// loadSeating, which already drops tables of cancelled sponsorships.
export function buildSponsorList(
  sponsors: Row<"sponsors", "id" | "display_name" | "email">[],
  sponsorships: Row<"sponsorships", "id" | "sponsor_id" | "pledged_cents" | "status">[],
  tables: SeatingTable[],
): SponsorSummary[] {
  return sponsors
    .map((s) => {
      const mine = sponsorships.filter((p) => p.sponsor_id === s.id && p.status === "committed");
      const ids = new Set(mine.map((p) => p.id));
      const own = tables.filter((t) => ids.has(t.sponsorshipId));
      return {
        id: s.id,
        name: s.display_name,
        email: s.email,
        pledgedCents: mine.reduce((sum, p) => sum + Number(p.pledged_cents), 0),
        tableCount: own.length,
        tables: own,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// The caller must already have checked the admin role and pass its eventId.
export async function loadSponsorList(admin: SupabaseClient<Database>, eventId: string) {
  const [sponsors, sponsorships, seating] = await Promise.all([
    readAll("loadSponsorList sponsors", (f, t) =>
      admin.from("sponsors").select("id, display_name, email").eq("event_id", eventId).order("id").range(f, t),
    ),
    readAll("loadSponsorList sponsorships", (f, t) =>
      admin
        .from("sponsorships")
        .select("id, sponsor_id, pledged_cents, status")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    loadSeating(admin, eventId),
  ]);
  return buildSponsorList(sponsors, sponsorships, seating.tables);
}

export type GuestParse = { ok: true; attendees: AttendeeInput[] } | { ok: false; message: string };

// One guest per submit: a name and an email.
export function parseGuestForm(fd: FormData): GuestParse {
  const parsed = parseAttendees(fd, 1);
  if (parsed.ok) return parsed;
  return { ok: false, message: `${Object.values(parsed.errors).join(" ")} Nothing was saved.` };
}

// Plain-words text for a failed admin_add_sponsored_guests call.
export function guestErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "P0002") return "That table is no longer active in this gala. Nothing was saved.";
  if (error.code === "55000") return "The gala is closed to registrations. Nothing was saved.";
  if (error.code === "22023") return "Check the guest name and email. Nothing was saved.";
  return "The guest could not be added. Try again. Nothing was saved.";
}
