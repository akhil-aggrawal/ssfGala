import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computeReports } from "@/lib/admin/reports";
import { ReportsView } from "./reports-view";

const reports = computeReports({
  tiers: [{ id: "gold", name: "Gold", table_inventory: 4 }],
  sponsorships: [{ id: "s1", pledged_cents: 200000, status: "committed", sponsor: { display_name: "Acme" } }],
  tables: [{ id: "t1", sponsorship_id: "s1", tier_id: "gold", capacity: 1, physical_table_number: "7" }],
  registrations: [{ id: "r1", kind: "sponsored", tier_id: "gold", status: "registered", sponsored_table_id: "t1" }],
  attendees: [
    { id: "a1", registration_id: "r1", full_name: "Ann", email: "ann@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a2", registration_id: "r1", full_name: "Ben", email: "ben@x.test", assigned_table_number: null, cancelled_at: null },
  ],
  payments: [
    { id: "r", provider: "offline", purpose: "sponsorship", status: "succeeded", amount_cents: 50000, sponsorship_id: "s1", received_at: "2027-01-05T18:00:00Z" },
  ],
  allocations: [],
});

const text = renderToStaticMarkup(<ReportsView reports={reports} />)
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

describe("ReportsView", () => {
  it("renders every FR-10 report heading", () => {
    for (const title of [
      "Table allocations by tier",
      "Sponsor pledges",
      "Roster",
      "Paid tickets",
      "Guest contributions",
      "Complimentary attendees",
      "Offline receipts",
      "Outstanding balances",
      "Overbooked tables",
    ]) {
      expect(text).toContain(title);
    }
  });

  it("shows totals and the overbooked table", () => {
    expect(text).toContain("Total $2,000.00 $500.00 $1,500.00");
    expect(text).toContain("7 Acme Gold 2 1");
    expect(text).toContain("Jan 5, 2027");
  });

  it("shows a plain message for an empty report", () => {
    expect(text).toContain("No paid tickets yet.");
    expect(text).toContain("No complimentary attendees.");
  });
});
