import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Tables = Database["public"]["Tables"];
type Row<T extends keyof Tables, K extends keyof Tables[T]["Row"]> = Pick<Tables[T]["Row"], K>;

// The raw rows of one event that the overview is computed from.
export type OverviewRows = {
  payments: Row<"payments", "provider" | "purpose" | "status" | "amount_cents" | "sponsorship_id">[];
  sponsorships: Row<"sponsorships", "id" | "pledged_cents" | "status">[];
  tables: Row<"sponsored_tables", "id" | "capacity" | "physical_table_number">[];
  registrations: Row<"registrations", "id" | "status" | "sponsored_table_id">[];
  attendees: Row<"attendees", "registration_id" | "assigned_table_number" | "cancelled_at">[];
};

// Amounts are integer USD cents.
export type Overview = {
  attendeeCount: number;
  stripeCollectedCents: number;
  offlineReceiptsCents: number;
  outstandingSponsorshipCents: number;
  overbookedTables: number;
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// One seat rule for /admin and /admin/tables: an active guest counts toward
// their sponsored table unless an admin moved them to a different number.
export const sitsAtSponsoredTable = (
  assignedTableNumber: string | null,
  tableNumber: string | null | undefined,
) => assignedTableNumber === null || assignedTableNumber === tableNumber;

export function computeOverview(rows: OverviewRows): Overview {
  const succeeded = rows.payments.filter((p) => p.status === "succeeded");
  const offline = succeeded.filter((p) => p.provider === "offline");

  // Active attendee: not cancelled, on a registration that is not cancelled.
  const liveRegistrations = new Map(
    rows.registrations.filter((r) => r.status !== "cancelled").map((r) => [r.id, r]),
  );
  const active = rows.attendees.filter(
    (a) => a.cancelled_at === null && liveRegistrations.has(a.registration_id),
  );

  const tables = new Map(rows.tables.map((t) => [t.id, t]));
  const seated = new Map<string, number>();
  for (const a of active) {
    const table = tables.get(liveRegistrations.get(a.registration_id)!.sponsored_table_id ?? "");
    if (table && sitsAtSponsoredTable(a.assigned_table_number, table.physical_table_number)) {
      seated.set(table.id, (seated.get(table.id) ?? 0) + 1);
    }
  }

  // Outstanding per committed pledge, floored at zero so one overpaid
  // pledge never hides another sponsor's balance.
  const received = new Map<string, number>();
  for (const p of offline) {
    if (p.purpose === "sponsorship" && p.sponsorship_id) {
      received.set(p.sponsorship_id, (received.get(p.sponsorship_id) ?? 0) + p.amount_cents);
    }
  }
  const outstanding = rows.sponsorships
    .filter((s) => s.status === "committed")
    .map((s) => Math.max(0, s.pledged_cents - (received.get(s.id) ?? 0)));

  return {
    attendeeCount: active.length,
    stripeCollectedCents: sum(succeeded.filter((p) => p.provider === "stripe").map((p) => p.amount_cents)),
    offlineReceiptsCents: sum(offline.map((p) => p.amount_cents)),
    outstandingSponsorshipCents: sum(outstanding),
    overbookedTables: rows.tables.filter((t) => (seated.get(t.id) ?? 0) > t.capacity).length,
  };
}

const PAGE = 1000; // PostgREST max_rows (supabase/config.toml)

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// Reads every row by paging; a failed page throws so an error never reads as zero.
export async function readAll<T>(label: string, page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// Loads the overview for one event with the service-role client. The caller
// must already have checked the admin role (requireRole) and pass its eventId.
export async function loadOverview(
  admin: SupabaseClient<Database>,
  eventId: string,
): Promise<Overview> {
  const [payments, sponsorships, tables, registrations, attendees] = await Promise.all([
    readAll("loadOverview payments", (f, t) =>
      admin
        .from("payments")
        .select("provider, purpose, status, amount_cents, sponsorship_id")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll("loadOverview sponsorships", (f, t) =>
      admin
        .from("sponsorships")
        .select("id, pledged_cents, status")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll("loadOverview sponsored_tables", (f, t) =>
      admin
        .from("sponsored_tables")
        .select("id, capacity, physical_table_number")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll("loadOverview registrations", (f, t) =>
      admin
        .from("registrations")
        .select("id, status, sponsored_table_id")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll("loadOverview attendees", (f, t) =>
      admin
        .from("attendees")
        .select("registration_id, assigned_table_number, cancelled_at")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
  ]);
  return computeOverview({ payments, sponsorships, tables, registrations, attendees });
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatCents = (cents: number) => usd.format(cents / 100);
