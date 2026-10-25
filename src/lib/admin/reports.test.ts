import { describe, expect, it } from "vitest";
import { computeOverview } from "./overview";
import { computeReports, type ReportRows } from "./reports";

// One small gala with every edge FR-10 reports must handle:
// cancelled attendees, cancelled registrations, a cancelled pledge,
// failed / pending / refunded payments and an overbooked table.
const rows: ReportRows = {
  tiers: [
    { id: "gold", name: "Gold", table_inventory: 5 },
    { id: "silver", name: "Silver", table_inventory: 3 },
  ],
  sponsorships: [
    { id: "s1", pledged_cents: 200000, status: "committed", sponsor: { display_name: "Acme" } },
    { id: "s2", pledged_cents: 150000, status: "committed", sponsor: { display_name: "Birch" } },
    { id: "s3", pledged_cents: 250000, status: "cancelled", sponsor: { display_name: "Gone" } },
  ],
  tables: [
    { id: "t1", sponsorship_id: "s1", tier_id: "gold", capacity: 2, physical_table_number: "7" },
    { id: "t2", sponsorship_id: "s2", tier_id: "silver", capacity: 2, physical_table_number: null },
    { id: "t3", sponsorship_id: "s3", tier_id: "gold", capacity: 2, physical_table_number: "9" },
  ],
  registrations: [
    { id: "rT1", kind: "sponsored", tier_id: "gold", status: "registered", sponsored_table_id: "t1" },
    { id: "rT2", kind: "sponsored", tier_id: "silver", status: "registered", sponsored_table_id: "t2" },
    { id: "rInd", kind: "individual", tier_id: "gold", status: "registered", sponsored_table_id: null },
    { id: "rFail", kind: "individual", tier_id: "silver", status: "pending_payment", sponsored_table_id: null },
    { id: "rGone", kind: "individual", tier_id: "gold", status: "cancelled", sponsored_table_id: null },
    { id: "rComp", kind: "complimentary", tier_id: "silver", status: "registered", sponsored_table_id: null },
    { id: "rOff", kind: "offline_paid", tier_id: "silver", status: "registered", sponsored_table_id: null },
  ],
  attendees: [
    { id: "a1", registration_id: "rT1", full_name: "Ann", email: "ann@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a2", registration_id: "rT1", full_name: "Ben", email: "ben@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a3", registration_id: "rT1", full_name: "Cy", email: "cy@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a4", registration_id: "rT2", full_name: "Di", email: "di@x.test", assigned_table_number: "12", cancelled_at: null },
    { id: "a5", registration_id: "rT2", full_name: "Ed", email: "ed@x.test", assigned_table_number: null, cancelled_at: "2026-10-01T00:00:00Z" },
    { id: "a6", registration_id: "rInd", full_name: "Flo", email: "flo@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a7", registration_id: "rInd", full_name: "Gus", email: "gus@x.test", assigned_table_number: null, cancelled_at: "2026-10-01T00:00:00Z" },
    { id: "a8", registration_id: "rFail", full_name: "Hal", email: "hal@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a9", registration_id: "rGone", full_name: "Ivy", email: "ivy@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a10", registration_id: "rComp", full_name: "Jo", email: "jo@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a11", registration_id: "rComp", full_name: "Kit", email: "kit@x.test", assigned_table_number: null, cancelled_at: "2026-10-01T00:00:00Z" },
    { id: "a12", registration_id: "rOff", full_name: "Lu", email: "lu@x.test", assigned_table_number: null, cancelled_at: null },
  ],
  payments: [
    // Individual ticket paid for Flo and Gus; Gus later cancelled.
    { id: "pInd", provider: "stripe", purpose: "ticket", status: "succeeded", amount_cents: 40000, sponsorship_id: null, received_at: null },
    { id: "pFail", provider: "stripe", purpose: "ticket", status: "failed", amount_cents: 15000, sponsorship_id: null, received_at: null },
    { id: "pGone", provider: "stripe", purpose: "ticket", status: "refunded", amount_cents: 20000, sponsorship_id: null, received_at: null },
    { id: "pOff", provider: "offline", purpose: "ticket", status: "succeeded", amount_cents: 15000, sponsorship_id: null, received_at: null },
    { id: "pC1", provider: "stripe", purpose: "seat_contribution", status: "succeeded", amount_cents: 5000, sponsorship_id: null, received_at: null },
    { id: "pC2", provider: "stripe", purpose: "seat_contribution", status: "failed", amount_cents: 9900, sponsorship_id: null, received_at: null },
    { id: "pC3", provider: "stripe", purpose: "seat_contribution", status: "succeeded", amount_cents: 3000, sponsorship_id: null, received_at: null },
    { id: "r1", provider: "offline", purpose: "sponsorship", status: "succeeded", amount_cents: 50000, sponsorship_id: "s1", received_at: "2026-10-02T17:00:00Z" },
    { id: "r2", provider: "offline", purpose: "sponsorship", status: "refunded", amount_cents: 80000, sponsorship_id: "s2", received_at: "2026-10-03T17:00:00Z" },
    { id: "r3", provider: "offline", purpose: "sponsorship", status: "succeeded", amount_cents: 60000, sponsorship_id: "s2", received_at: "2026-10-04T17:00:00Z" },
  ],
  allocations: [
    { payment_id: "pInd", attendee_id: "a6", amount_cents: 20000 },
    { payment_id: "pInd", attendee_id: "a7", amount_cents: 20000 },
    { payment_id: "pFail", attendee_id: "a8", amount_cents: 15000 },
    { payment_id: "pGone", attendee_id: "a9", amount_cents: 20000 },
    { payment_id: "pOff", attendee_id: "a12", amount_cents: 15000 },
    { payment_id: "pC1", attendee_id: "a1", amount_cents: 5000 },
    { payment_id: "pC2", attendee_id: "a2", amount_cents: 9900 },
    { payment_id: "pC3", attendee_id: "a5", amount_cents: 3000 }, // Ed, cancelled
  ],
};

const empty: ReportRows = {
  tiers: [],
  sponsorships: [],
  tables: [],
  registrations: [],
  attendees: [],
  payments: [],
  allocations: [],
};

describe("computeReports", () => {
  const r = computeReports(rows);

  it("per-tier table allocations count live sponsored tables against inventory", () => {
    expect(r.tierAllocations.rows).toEqual([
      { tier: "Gold", inventory: 5, allocated: 1, available: 4 },
      { tier: "Silver", inventory: 3, allocated: 1, available: 2 },
    ]);
    expect(r.tierAllocations.total).toEqual({ inventory: 8, allocated: 2, available: 6 });
  });

  it("sponsor pledges list committed pledges only", () => {
    expect(r.pledges.rows).toEqual([
      { sponsor: "Acme", tables: 1, pledgedCents: 200000 },
      { sponsor: "Birch", tables: 1, pledgedCents: 150000 },
    ]);
    expect(r.pledges.total).toEqual({ tables: 2, pledgedCents: 350000 });
  });

  it("roster lists active attendees only, sorted by name, with their seat", () => {
    expect(r.roster.map((a) => a.name)).toEqual(["Ann", "Ben", "Cy", "Di", "Flo", "Hal", "Jo", "Lu"]);
    expect(r.roster.find((a) => a.name === "Ann")).toEqual({
      name: "Ann",
      email: "ann@x.test",
      tier: "Gold",
      kind: "Sponsored",
      sponsor: "Acme",
      table: "7",
      paid: true,
    });
    expect(r.roster.find((a) => a.name === "Di")?.table).toBe("12");
    expect(r.roster.find((a) => a.name === "Hal")).toMatchObject({ kind: "Ticket", paid: false, table: null });
    expect(r.roster.find((a) => a.name === "Jo")).toMatchObject({ kind: "Complimentary", paid: false });
  });

  it("paid tickets count only succeeded payments to active attendees", () => {
    expect(r.paidTickets.rows).toEqual([
      { tier: "Gold", seats: 1, amountCents: 20000 },
      { tier: "Silver", seats: 1, amountCents: 15000 },
    ]);
    expect(r.paidTickets.total).toEqual({ seats: 2, amountCents: 35000 });
  });

  it("guest contributions count only succeeded contributions from active guests", () => {
    expect(r.contributions.rows).toEqual([{ sponsor: "Acme", guests: 1, amountCents: 5000 }]);
    expect(r.contributions.total).toEqual({ guests: 1, amountCents: 5000 });
  });

  it("complimentary count excludes cancelled attendees", () => {
    expect(r.complimentary.rows).toEqual([{ tier: "Silver", count: 1 }]);
    expect(r.complimentary.total).toBe(1);
  });

  it("offline receipts list succeeded sponsorship receipts only", () => {
    expect(r.offlineReceipts.rows).toEqual([
      { sponsor: "Acme", receivedAt: "2026-10-02T17:00:00Z", amountCents: 50000 },
      { sponsor: "Birch", receivedAt: "2026-10-04T17:00:00Z", amountCents: 60000 },
    ]);
    expect(r.offlineReceipts.total).toBe(110000);
  });

  it("outstanding balances = committed pledge minus received, floored at zero", () => {
    expect(r.balances.rows).toEqual([
      { sponsor: "Acme", pledgedCents: 200000, receivedCents: 50000, outstandingCents: 150000 },
      { sponsor: "Birch", pledgedCents: 150000, receivedCents: 60000, outstandingCents: 90000 },
    ]);
    expect(r.balances.total).toEqual({ pledgedCents: 350000, receivedCents: 110000, outstandingCents: 240000 });
  });

  it("overbooked tables list tables with more active guests than seats", () => {
    expect(r.overbooked).toEqual([{ table: "7", sponsor: "Acme", tier: "Gold", seated: 3, capacity: 2 }]);
  });

  it("agrees with the admin overview on shared totals", () => {
    const o = computeOverview(rows);
    expect(r.balances.total.outstandingCents).toBe(o.outstandingSponsorshipCents);
    expect(r.overbooked.length).toBe(o.overbookedTables);
    expect(r.roster.length).toBe(o.attendeeCount);
  });

  it("returns empty reports with zero totals for an event with no data", () => {
    const e = computeReports(empty);
    expect(e.roster).toEqual([]);
    expect(e.overbooked).toEqual([]);
    expect(e.tierAllocations.total).toEqual({ inventory: 0, allocated: 0, available: 0 });
    expect(e.balances.total).toEqual({ pledgedCents: 0, receivedCents: 0, outstandingCents: 0 });
    expect(e.complimentary.total).toBe(0);
  });
});
