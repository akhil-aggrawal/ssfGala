import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readAll } from "./overview";

// Tables & Seating (/admin/tables): who sits where, and which sponsored
// tables are over capacity. Admin only: overbooking is never shown to guests.
// A guest's table is their own assigned_table_number when an admin moved
// them, otherwise their sponsored table's physical_table_number. A moved guest
// stops counting toward their sponsored table, so moves clear Overbooked.

type Tables = Database["public"]["Tables"];
type Row<T extends keyof Tables, K extends keyof Tables[T]["Row"]> = Pick<Tables[T]["Row"], K>;

export type SeatingRows = {
  tiers: Row<"seating_tiers", "id" | "name">[];
  sponsors: Row<"sponsors", "id" | "display_name">[];
  sponsorships: Row<"sponsorships", "id" | "sponsor_id" | "status">[];
  tables: Row<"sponsored_tables", "id" | "sponsorship_id" | "tier_id" | "capacity" | "physical_table_number">[];
  registrations: Row<"registrations", "id" | "status" | "tier_id" | "sponsored_table_id">[];
  attendees: Row<
    "attendees",
    "id" | "registration_id" | "full_name" | "email" | "assigned_table_number" | "cancelled_at"
  >[];
};

export type SeatingTable = {
  id: string;
  sponsorName: string;
  tierName: string;
  capacity: number;
  guestCount: number;
  overbooked: boolean;
  tableNumber: string | null;
};

export type SeatingGuest = {
  id: string;
  fullName: string;
  email: string;
  tierName: string;
  // null for an individual ticket (no sponsored table).
  sponsorName: string | null;
  tableNumber: string | null;
  moved: boolean;
};

export function buildSeating(rows: SeatingRows): { tables: SeatingTable[]; guests: SeatingGuest[] } {
  const tierName = new Map(rows.tiers.map((t) => [t.id, t.name]));
  const sponsorName = new Map(rows.sponsors.map((s) => [s.id, s.display_name]));
  const sponsorships = new Map(rows.sponsorships.map((s) => [s.id, s]));
  const tables = new Map(rows.tables.map((t) => [t.id, t]));
  const tableSponsor = (sponsorshipId: string) =>
    sponsorName.get(sponsorships.get(sponsorshipId)?.sponsor_id ?? "") ?? "Unknown sponsor";

  // Active guest: not cancelled, on a registration that is not cancelled.
  const liveRegistrations = new Map(
    rows.registrations.filter((r) => r.status !== "cancelled").map((r) => [r.id, r]),
  );
  const active = rows.attendees.filter(
    (a) => a.cancelled_at === null && liveRegistrations.has(a.registration_id),
  );

  const seated = new Map<string, number>();
  const guests: SeatingGuest[] = active.map((a) => {
    const reg = liveRegistrations.get(a.registration_id)!;
    const table = reg.sponsored_table_id ? tables.get(reg.sponsored_table_id) : undefined;
    // A guest moved to another number no longer sits at (or overbooks) this table.
    const atTable =
      a.assigned_table_number === null || a.assigned_table_number === table?.physical_table_number;
    if (table && atTable) seated.set(table.id, (seated.get(table.id) ?? 0) + 1);
    return {
      id: a.id,
      fullName: a.full_name,
      email: a.email,
      tierName: tierName.get(reg.tier_id) ?? "",
      sponsorName: table ? tableSponsor(table.sponsorship_id) : null,
      tableNumber: a.assigned_table_number ?? table?.physical_table_number ?? null,
      moved: a.assigned_table_number !== null,
    };
  });

  const liveTables: SeatingTable[] = rows.tables
    .filter((t) => sponsorships.get(t.sponsorship_id)?.status !== "cancelled")
    .map((t) => {
      const guestCount = seated.get(t.id) ?? 0;
      return {
        id: t.id,
        sponsorName: tableSponsor(t.sponsorship_id),
        tierName: tierName.get(t.tier_id) ?? "",
        capacity: t.capacity,
        guestCount,
        overbooked: guestCount > t.capacity,
        tableNumber: t.physical_table_number,
      };
    });

  const byText = (a: string, b: string) => a.localeCompare(b);
  liveTables.sort((a, b) => byText(a.sponsorName, b.sponsorName) || byText(a.id, b.id));
  guests.sort((a, b) => byText(a.fullName, b.fullName) || byText(a.id, b.id));
  return { tables: liveTables, guests };
}

// Loads one event's seating with the service-role client. The caller must
// already have checked the admin role (requireRole) and pass its eventId.
export async function loadSeating(admin: SupabaseClient<Database>, eventId: string) {
  const label = (table: string) => `loadSeating ${table}`;
  const [tiers, sponsors, sponsorships, tables, registrations, attendees] = await Promise.all([
    readAll(label("seating_tiers"), (f, t) =>
      admin.from("seating_tiers").select("id, name").eq("event_id", eventId).order("id").range(f, t),
    ),
    readAll(label("sponsors"), (f, t) =>
      admin.from("sponsors").select("id, display_name").eq("event_id", eventId).order("id").range(f, t),
    ),
    readAll(label("sponsorships"), (f, t) =>
      admin
        .from("sponsorships")
        .select("id, sponsor_id, status")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll(label("sponsored_tables"), (f, t) =>
      admin
        .from("sponsored_tables")
        .select("id, sponsorship_id, tier_id, capacity, physical_table_number")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll(label("registrations"), (f, t) =>
      admin
        .from("registrations")
        .select("id, status, tier_id, sponsored_table_id")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll(label("attendees"), (f, t) =>
      admin
        .from("attendees")
        .select("id, registration_id, full_name, email, assigned_table_number, cancelled_at")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
  ]);
  return buildSeating({ tiers, sponsors, sponsorships, tables, registrations, attendees });
}

// Table numbers are short labels such as "12" or "VIP-1"; blank clears one.
export function parseTableNumber(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (value === "" || /^[A-Za-z0-9 -]{1,10}$/.test(value)) return { ok: true, value };
  return { ok: false, error: "Table number must be up to 10 letters, digits, spaces or dashes." };
}

// Plain-words text for a failed set_table_number / move_attendee call.
export function seatingErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "55000") return "This gala is archived and read-only. Nothing was saved.";
  if (error.code === "P0002") return "That table or guest no longer exists in this gala. Nothing was saved.";
  return "The table number could not be saved. Try again.";
}
