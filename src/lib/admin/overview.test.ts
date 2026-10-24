import { describe, expect, it } from "vitest";
import { computeOverview, loadOverview, type OverviewRows } from "./overview";

const empty: OverviewRows = {
  payments: [],
  sponsorships: [],
  tables: [],
  registrations: [],
  attendees: [],
};

const pay = (p: Partial<OverviewRows["payments"][number]>): OverviewRows["payments"][number] => ({
  provider: "stripe",
  purpose: "ticket",
  status: "succeeded",
  amount_cents: 0,
  sponsorship_id: null,
  ...p,
});

describe("computeOverview", () => {
  it("returns zeros for an event with no data", () => {
    expect(computeOverview(empty)).toEqual({
      attendeeCount: 0,
      stripeCollectedCents: 0,
      offlineReceiptsCents: 0,
      outstandingSponsorshipCents: 0,
      overbookedTables: 0,
    });
  });

  it("sums only succeeded Stripe payments into Stripe collected", () => {
    const o = computeOverview({
      ...empty,
      payments: [
        pay({ amount_cents: 15000 }),
        pay({ amount_cents: 2500, purpose: "seat_contribution" }),
        pay({ amount_cents: 20000, status: "pending" }),
        pay({ amount_cents: 20000, status: "failed" }),
        pay({ amount_cents: 25000, status: "refunded" }),
        pay({ amount_cents: 99900, provider: "offline" }),
      ],
    });
    expect(o.stripeCollectedCents).toBe(17500);
  });

  it("sums succeeded offline payments into offline receipts", () => {
    const o = computeOverview({
      ...empty,
      payments: [
        pay({ provider: "offline", amount_cents: 15000 }),
        pay({ provider: "offline", purpose: "sponsorship", sponsorship_id: "s1", amount_cents: 50000 }),
        pay({ provider: "offline", amount_cents: 7000, status: "refunded" }),
        pay({ amount_cents: 20000 }),
      ],
    });
    expect(o.offlineReceiptsCents).toBe(65000);
  });

  it("outstanding sponsorship = committed pledges minus succeeded offline receipts", () => {
    const o = computeOverview({
      ...empty,
      sponsorships: [
        { id: "s1", pledged_cents: 200000, status: "committed" },
        { id: "s2", pledged_cents: 250000, status: "committed" },
        { id: "s3", pledged_cents: 150000, status: "cancelled" },
      ],
      payments: [
        pay({ provider: "offline", purpose: "sponsorship", sponsorship_id: "s1", amount_cents: 50000 }),
        pay({ provider: "offline", purpose: "sponsorship", sponsorship_id: "s1", amount_cents: 30000, status: "pending" }),
        pay({ provider: "offline", purpose: "sponsorship", sponsorship_id: "s2", amount_cents: 100000, status: "refunded" }),
        // A receipt against a cancelled pledge does not reduce the others.
        pay({ provider: "offline", purpose: "sponsorship", sponsorship_id: "s3", amount_cents: 150000 }),
      ],
    });
    expect(o.outstandingSponsorshipCents).toBe(200000 + 250000 - 50000);
  });

  it("an overpaid pledge never makes another sponsor's balance look smaller", () => {
    const o = computeOverview({
      ...empty,
      sponsorships: [
        { id: "s1", pledged_cents: 100000, status: "committed" },
        { id: "s2", pledged_cents: 100000, status: "committed" },
      ],
      payments: [
        pay({ provider: "offline", purpose: "sponsorship", sponsorship_id: "s1", amount_cents: 150000 }),
      ],
    });
    expect(o.outstandingSponsorshipCents).toBe(100000);
  });

  it("counts active attendees: not cancelled, registration not cancelled", () => {
    const o = computeOverview({
      ...empty,
      registrations: [
        { id: "r1", status: "registered", sponsored_table_id: null },
        { id: "r2", status: "cancelled", sponsored_table_id: null },
        { id: "r3", status: "pending_payment", sponsored_table_id: null },
      ],
      attendees: [
        { registration_id: "r1", cancelled_at: null },
        { registration_id: "r1", cancelled_at: "2026-10-01T00:00:00Z" },
        { registration_id: "r2", cancelled_at: null },
        { registration_id: "r3", cancelled_at: null },
      ],
    });
    expect(o.attendeeCount).toBe(2);
  });

  it("counts tables with more than capacity active attendees as overbooked", () => {
    const seat = (registration_id: string, cancelled_at: string | null = null) => ({
      registration_id,
      cancelled_at,
    });
    const o = computeOverview({
      ...empty,
      tables: [
        { id: "t-full", capacity: 10 },
        { id: "t-over", capacity: 10 },
        { id: "t-small", capacity: 2 },
        { id: "t-cancelled", capacity: 1 },
      ],
      registrations: [
        { id: "rf", status: "registered", sponsored_table_id: "t-full" },
        { id: "ro", status: "registered", sponsored_table_id: "t-over" },
        { id: "rs", status: "pending_payment", sponsored_table_id: "t-small" },
        { id: "rc", status: "cancelled", sponsored_table_id: "t-cancelled" },
        { id: "rx", status: "registered", sponsored_table_id: "t-cancelled" },
      ],
      attendees: [
        ...Array.from({ length: 10 }, () => seat("rf")),
        ...Array.from({ length: 11 }, () => seat("ro")),
        seat("rs"),
        seat("rs"),
        seat("rs"),
        seat("rc"),
        seat("rc"),
        seat("rx"),
        seat("rx", "2026-10-01T00:00:00Z"),
      ],
    });
    // t-full is exactly at capacity; t-cancelled has one active guest.
    expect(o.overbookedTables).toBe(2);
  });
});

// Chainable fake of the service-role client. Each table returns its rows in
// pages of `pageSize`; every filter call is recorded per table.
function fakeAdmin(rows: Partial<Record<string, unknown[]>>, error: string | null = null) {
  const calls: Record<string, unknown[][]> = {};
  const from = (table: string) => {
    const log = (calls[table] ??= []);
    const chain = {
      select: (...a: unknown[]) => (log.push(["select", ...a]), chain),
      eq: (...a: unknown[]) => (log.push(["eq", ...a]), chain),
      order: (...a: unknown[]) => (log.push(["order", ...a]), chain),
      range: async (start: number, end: number) => {
        log.push(["range", start, end]);
        if (error) return { data: null, error: { message: error } };
        return { data: (rows[table] ?? []).slice(start, end + 1), error: null };
      },
    };
    return chain;
  };
  return { client: { from } as never, calls };
}

describe("loadOverview", () => {
  it("scopes every query to the given event", async () => {
    const admin = fakeAdmin({});
    await loadOverview(admin.client, "ev1");
    for (const table of ["payments", "sponsorships", "sponsored_tables", "registrations", "attendees"]) {
      expect(admin.calls[table], table).toContainEqual(["eq", "event_id", "ev1"]);
    }
  });

  it("reads past the 1000-row page limit", async () => {
    const payments = Array.from({ length: 1500 }, () => pay({ amount_cents: 100 }));
    const admin = fakeAdmin({ payments });
    const o = await loadOverview(admin.client, "ev1");
    expect(o.stripeCollectedCents).toBe(150000);
    expect(admin.calls.payments.filter((c) => c[0] === "range")).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
    ]);
  });

  it("throws when a query fails, so an error never reads as zero", async () => {
    await expect(loadOverview(fakeAdmin({}, "boom").client, "ev1")).rejects.toThrow("boom");
  });
});
