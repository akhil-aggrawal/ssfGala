import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Tables = Database["public"]["Tables"];
type Row<T extends keyof Tables, K extends keyof Tables[T]["Row"]> = Pick<Tables[T]["Row"], K>;

// The raw rows of one event that the overview is computed from.
export type OverviewRows = {
  payments: Row<"payments", "provider" | "purpose" | "status" | "amount_cents" | "sponsorship_id">[];
  sponsorships: Row<"sponsorships", "id" | "pledged_cents" | "status">[];
  tables: Row<"sponsored_tables", "id" | "sponsorship_id" | "capacity" | "physical_table_number">[];
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

// One seat rule for /admin and /admin/tables: an active guest sits at their
// sponsored table unless an admin moved them to a different number.
export const sitsAtSponsoredTable = (
  assignedTableNumber: string | null,
  tableNumber: string | null | undefined,
) => assignedTableNumber === null || assignedTableNumber === tableNumber;

type SeatTable = { id: string; physical_table_number: string | null };
type SeatGuest = { tableId: string | null; assignedTableNumber: string | null };

// Active guests per sponsored table id. A moved guest counts at the table
// whose physical number they were moved to, so a move can clear Overbooked
// at one table and cause it at another. Pass only live tables (liveTables).
export function countSeated(tables: SeatTable[], guests: SeatGuest[]): Map<string, number> {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const byNumber = new Map<string, string>();
  for (const t of tables) {
    if (t.physical_table_number && !byNumber.has(t.physical_table_number)) {
      byNumber.set(t.physical_table_number, t.id);
    }
  }
  const seated = new Map<string, number>();
  for (const g of guests) {
    const own = g.tableId ? byId.get(g.tableId) : undefined;
    const at = sitsAtSponsoredTable(g.assignedTableNumber, own?.physical_table_number)
      ? own?.id
      : byNumber.get(g.assignedTableNumber ?? "");
    if (at) seated.set(at, (seated.get(at) ?? 0) + 1);
  }
  return seated;
}

// Sponsored tables whose sponsorship is not cancelled.
export function liveTables<T extends { sponsorship_id: string }>(
  tables: T[],
  sponsorships: { id: string; status: string }[],
): T[] {
  const cancelled = new Set(sponsorships.filter((s) => s.status === "cancelled").map((s) => s.id));
  return tables.filter((t) => !cancelled.has(t.sponsorship_id));
}

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

  const tables = liveTables(rows.tables, rows.sponsorships);
  const seated = countSeated(
    tables,
    active.map((a) => ({
      tableId: liveRegistrations.get(a.registration_id)!.sponsored_table_id,
      assignedTableNumber: a.assigned_table_number,
    })),
  );

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
    overbookedTables: tables.filter((t) => (seated.get(t.id) ?? 0) > t.capacity).length,
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
        .select("id, sponsorship_id, capacity, physical_table_number")
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
