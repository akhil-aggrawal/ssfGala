import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { countSeated, liveTables, readAll, sitsAtSponsoredTable } from "./overview";

// FR-10 reports for /admin/reports. Read-only. Every total counts active
// attendees only (not cancelled, on a registration that is not cancelled)
// and succeeded payments only. Amounts are integer USD cents.

type Tables = Database["public"]["Tables"];
type Row<T extends keyof Tables, K extends keyof Tables[T]["Row"]> = Pick<Tables[T]["Row"], K>;

export type ReportRows = {
  tiers: Row<"seating_tiers", "id" | "name" | "table_inventory">[];
  sponsorships: (Row<"sponsorships", "id" | "pledged_cents" | "status"> & {
    sponsor: { display_name: string } | null;
  })[];
  tables: Row<"sponsored_tables", "id" | "sponsorship_id" | "tier_id" | "capacity" | "physical_table_number">[];
  registrations: Row<"registrations", "id" | "kind" | "tier_id" | "status" | "sponsored_table_id">[];
  attendees: Row<
    "attendees",
    "id" | "registration_id" | "full_name" | "email" | "assigned_table_number" | "cancelled_at"
  >[];
  payments: Row<
    "payments",
    "id" | "provider" | "purpose" | "status" | "amount_cents" | "sponsorship_id" | "received_at"
  >[];
  allocations: Row<"payment_allocations", "payment_id" | "attendee_id" | "amount_cents">[];
};

export type RosterEntry = {
  name: string;
  email: string;
  tier: string;
  kind: string;
  sponsor: string | null;
  table: string | null;
  paid: boolean;
};

export type Reports = {
  tierAllocations: {
    rows: { tier: string; inventory: number; allocated: number; available: number }[];
    total: { inventory: number; allocated: number; available: number };
  };
  pledges: {
    rows: { sponsor: string; tables: number; pledgedCents: number }[];
    total: { tables: number; pledgedCents: number };
  };
  roster: RosterEntry[];
  paidTickets: {
    rows: { tier: string; seats: number; amountCents: number }[];
    total: { seats: number; amountCents: number };
  };
  contributions: {
    rows: { sponsor: string; guests: number; amountCents: number }[];
    total: { guests: number; amountCents: number };
  };
  complimentary: { rows: { tier: string; count: number }[]; total: number };
  offlineReceipts: {
    rows: { sponsor: string; receivedAt: string | null; amountCents: number }[];
    total: number;
  };
  balances: {
    rows: { sponsor: string; pledgedCents: number; receivedCents: number; outstandingCents: number }[];
    total: { pledgedCents: number; receivedCents: number; outstandingCents: number };
  };
  overbooked: { table: string | null; sponsor: string; tier: string; seated: number; capacity: number }[];
};

const KIND_LABELS: Record<string, string> = {
  individual: "Ticket",
  sponsored: "Sponsored",
  complimentary: "Complimentary",
  offline_paid: "Paid offline",
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// Adds n to key's count in an insertion-ordered map.
const bump = (m: Map<string, number>, key: string, n = 1) => m.set(key, (m.get(key) ?? 0) + n);

export function computeReports(rows: ReportRows): Reports {
  const tierName = new Map(rows.tiers.map((t) => [t.id, t.name]));
  const sponsorName = new Map(
    rows.sponsorships.map((s) => [s.id, s.sponsor?.display_name ?? "Unknown sponsor"]),
  );
  const committed = rows.sponsorships.filter((s) => s.status === "committed");
  const tables = liveTables(rows.tables, rows.sponsorships);
  const tableById = new Map(rows.tables.map((t) => [t.id, t]));

  const liveRegistrations = new Map(
    rows.registrations.filter((r) => r.status !== "cancelled").map((r) => [r.id, r]),
  );
  const active = rows.attendees.filter(
    (a) => a.cancelled_at === null && liveRegistrations.has(a.registration_id),
  );
  const activeIds = new Set(active.map((a) => a.id));
  const registrationOf = (a: { registration_id: string }) => liveRegistrations.get(a.registration_id)!;
  const sponsorOfRegistration = (r: { sponsored_table_id: string | null }) => {
    const t = r.sponsored_table_id ? tableById.get(r.sponsored_table_id) : undefined;
    return t ? (sponsorName.get(t.sponsorship_id) ?? null) : null;
  };

  // Succeeded money allocated to active attendees, by purpose.
  const succeeded = new Map(rows.payments.filter((p) => p.status === "succeeded").map((p) => [p.id, p]));
  const allocatedTo = (purpose: string) => {
    const byAttendee = new Map<string, number>();
    for (const a of rows.allocations) {
      if (succeeded.get(a.payment_id)?.purpose === purpose && activeIds.has(a.attendee_id)) {
        bump(byAttendee, a.attendee_id, a.amount_cents);
      }
    }
    return byAttendee;
  };
  const paidIds = new Set(
    rows.allocations.filter((a) => succeeded.has(a.payment_id)).map((a) => a.attendee_id),
  );

  // Per-tier table allocations.
  const tierRows = rows.tiers.map((t) => {
    const allocated = tables.filter((s) => s.tier_id === t.id).length;
    return { tier: t.name, inventory: t.table_inventory, allocated, available: t.table_inventory - allocated };
  });

  // Sponsor pledges (committed only).
  const pledgeRows = committed.map((s) => ({
    sponsor: sponsorName.get(s.id)!,
    tables: tables.filter((t) => t.sponsorship_id === s.id).length,
    pledgedCents: s.pledged_cents,
  }));

  // Roster.
  const roster: RosterEntry[] = active
    .map((a) => {
      const r = registrationOf(a);
      const own = r.sponsored_table_id ? tableById.get(r.sponsored_table_id) : undefined;
      const table = sitsAtSponsoredTable(a.assigned_table_number, own?.physical_table_number)
        ? (own?.physical_table_number ?? null)
        : a.assigned_table_number;
      return {
        name: a.full_name,
        email: a.email,
        tier: tierName.get(r.tier_id) ?? "Unknown tier",
        kind: KIND_LABELS[r.kind] ?? r.kind,
        sponsor: sponsorOfRegistration(r),
        table,
        paid: paidIds.has(a.id),
      };
    })
    .sort((x, y) => x.name.localeCompare(y.name) || x.email.localeCompare(y.email));

  // Keys of a per-tier map, in tier order (unknown tiers last).
  const inTierOrder = (m: Map<string, number>) =>
    [...new Set([...rows.tiers.map((t) => t.name), ...m.keys()])].filter((tier) => m.has(tier));

  const attendeeById = new Map(active.map((a) => [a.id, a]));

  // Paid tickets, by tier (in tier order).
  const ticketSeats = new Map<string, number>();
  const ticketCents = new Map<string, number>();
  for (const [id, cents] of allocatedTo("ticket")) {
    const tier = tierName.get(registrationOf(attendeeById.get(id)!).tier_id) ?? "Unknown tier";
    bump(ticketSeats, tier);
    bump(ticketCents, tier, cents);
  }
  const paidRows = inTierOrder(ticketSeats).map((tier) => ({ tier, seats: ticketSeats.get(tier)!, amountCents: ticketCents.get(tier)! }));

  // Guest seat contributions, by sponsor.
  const contribGuests = new Map<string, number>();
  const contribCents = new Map<string, number>();
  for (const [id, cents] of allocatedTo("seat_contribution")) {
    const sponsor = sponsorOfRegistration(registrationOf(attendeeById.get(id)!)) ?? "No sponsor";
    bump(contribGuests, sponsor);
    bump(contribCents, sponsor, cents);
  }
  const contributionRows = [...contribGuests.keys()].map((sponsor) => ({
    sponsor,
    guests: contribGuests.get(sponsor)!,
    amountCents: contribCents.get(sponsor)!,
  }));

  // Complimentary count, by tier.
  const comp = new Map<string, number>();
  for (const a of active) {
    const r = registrationOf(a);
    if (r.kind === "complimentary") bump(comp, tierName.get(r.tier_id) ?? "Unknown tier");
  }
  const compRows = inTierOrder(comp).map((tier) => ({ tier, count: comp.get(tier)! }));

  // Offline sponsorship receipts (succeeded) and balances per committed pledge.
  const receipts = rows.payments.filter(
    (p) => p.provider === "offline" && p.purpose === "sponsorship" && p.status === "succeeded" && p.sponsorship_id,
  );
  const receiptRows = receipts.map((p) => ({
    sponsor: sponsorName.get(p.sponsorship_id!) ?? "Unknown sponsor",
    receivedAt: p.received_at,
    amountCents: p.amount_cents,
  }));
  const balanceRows = committed.map((s) => {
    const receivedCents = sum(receipts.filter((p) => p.sponsorship_id === s.id).map((p) => p.amount_cents));
    return {
      sponsor: sponsorName.get(s.id)!,
      pledgedCents: s.pledged_cents,
      receivedCents,
      outstandingCents: Math.max(0, s.pledged_cents - receivedCents),
    };
  });

  // Overbooked tables (same seat rule as the overview).
  const seated = countSeated(
    tables,
    active.map((a) => ({
      tableId: registrationOf(a).sponsored_table_id,
      assignedTableNumber: a.assigned_table_number,
    })),
  );
  const overbooked = tables
    .filter((t) => (seated.get(t.id) ?? 0) > t.capacity)
    .map((t) => ({
      table: t.physical_table_number,
      sponsor: sponsorName.get(t.sponsorship_id) ?? "Unknown sponsor",
      tier: tierName.get(t.tier_id) ?? "Unknown tier",
      seated: seated.get(t.id) ?? 0,
      capacity: t.capacity,
    }));

  return {
    tierAllocations: {
      rows: tierRows,
      total: {
        inventory: sum(tierRows.map((t) => t.inventory)),
        allocated: sum(tierRows.map((t) => t.allocated)),
        available: sum(tierRows.map((t) => t.available)),
      },
    },
    pledges: {
      rows: pledgeRows,
      total: { tables: sum(pledgeRows.map((p) => p.tables)), pledgedCents: sum(pledgeRows.map((p) => p.pledgedCents)) },
    },
    roster,
    paidTickets: {
      rows: paidRows,
      total: { seats: sum(paidRows.map((p) => p.seats)), amountCents: sum(paidRows.map((p) => p.amountCents)) },
    },
    contributions: {
      rows: contributionRows,
      total: {
        guests: sum(contributionRows.map((c) => c.guests)),
        amountCents: sum(contributionRows.map((c) => c.amountCents)),
      },
    },
    complimentary: { rows: compRows, total: sum(compRows.map((c) => c.count)) },
    offlineReceipts: { rows: receiptRows, total: sum(receiptRows.map((r) => r.amountCents)) },
    balances: {
      rows: balanceRows,
      total: {
        pledgedCents: sum(balanceRows.map((b) => b.pledgedCents)),
        receivedCents: sum(balanceRows.map((b) => b.receivedCents)),
        outstandingCents: sum(balanceRows.map((b) => b.outstandingCents)),
      },
    },
    overbooked,
  };
}

// Loads every report for one event with the service-role client. The caller
// must already have checked the admin role (requireRole) and pass its eventId.
export async function loadReports(admin: SupabaseClient<Database>, eventId: string): Promise<Reports> {
  const [tiers, sponsorships, tables, registrations, attendees, payments, allocations] = await Promise.all([
    readAll("loadReports seating_tiers", (f, t) =>
      admin
        .from("seating_tiers")
        .select("id, name, table_inventory")
        .eq("event_id", eventId)
        .order("seat_price_cents")
        .order("id")
        .range(f, t),
    ),
    readAll("loadReports sponsorships", (f, t) =>
      admin
        .from("sponsorships")
        .select("id, pledged_cents, status, sponsor:sponsors(display_name)")
        .eq("event_id", eventId)
        .order("created_at")
        .order("id")
        .range(f, t),
    ),
    readAll("loadReports sponsored_tables", (f, t) =>
      admin
        .from("sponsored_tables")
        .select("id, sponsorship_id, tier_id, capacity, physical_table_number")
        .eq("event_id", eventId)
        .order("created_at")
        .order("id")
        .range(f, t),
    ),
    readAll("loadReports registrations", (f, t) =>
      admin
        .from("registrations")
        .select("id, kind, tier_id, status, sponsored_table_id")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll("loadReports attendees", (f, t) =>
      admin
        .from("attendees")
        .select("id, registration_id, full_name, email, assigned_table_number, cancelled_at")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll("loadReports payments", (f, t) =>
      admin
        .from("payments")
        .select("id, provider, purpose, status, amount_cents, sponsorship_id, received_at")
        .eq("event_id", eventId)
        .order("received_at")
        .order("id")
        .range(f, t),
    ),
    readAll("loadReports payment_allocations", (f, t) =>
      admin
        .from("payment_allocations")
        .select("payment_id, attendee_id, amount_cents")
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
  ]);
  return computeReports({ tiers, sponsorships, tables, registrations, attendees, payments, allocations });
}
