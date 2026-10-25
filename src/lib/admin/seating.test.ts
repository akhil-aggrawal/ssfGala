import { describe, expect, it } from "vitest";
import { computeOverview } from "./overview";
import { buildSeating, parseTableNumber, seatingErrorMessage, type SeatingRows } from "./seating";

const rows = (): SeatingRows => ({
  tiers: [
    { id: "gold", name: "Gold" },
    { id: "silver", name: "Silver" },
  ],
  sponsors: [
    { id: "sp1", display_name: "Acme" },
    { id: "sp2", display_name: "Bolt" },
  ],
  sponsorships: [
    { id: "s1", sponsor_id: "sp1", status: "committed" },
    { id: "s2", sponsor_id: "sp2", status: "committed" },
    { id: "s3", sponsor_id: "sp2", status: "cancelled" },
  ],
  tables: [
    { id: "t1", sponsorship_id: "s1", tier_id: "gold", capacity: 2, physical_table_number: "12" },
    { id: "t2", sponsorship_id: "s2", tier_id: "silver", capacity: 2, physical_table_number: null },
    { id: "t3", sponsorship_id: "s3", tier_id: "silver", capacity: 10, physical_table_number: null },
  ],
  registrations: [
    { id: "r1", status: "registered", tier_id: "gold", sponsored_table_id: "t1" },
    { id: "r2", status: "registered", tier_id: "silver", sponsored_table_id: "t2" },
    { id: "r3", status: "registered", tier_id: "silver", sponsored_table_id: null },
    { id: "r4", status: "cancelled", tier_id: "silver", sponsored_table_id: "t2" },
  ],
  attendees: [
    { id: "a1", registration_id: "r1", full_name: "Ann", email: "ann@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a2", registration_id: "r1", full_name: "Ben", email: "ben@x.test", assigned_table_number: "7", cancelled_at: null },
    { id: "a3", registration_id: "r1", full_name: "Cat", email: "cat@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a4", registration_id: "r2", full_name: "Dan", email: "dan@x.test", assigned_table_number: null, cancelled_at: "2026-10-01T00:00:00Z" },
    { id: "a5", registration_id: "r3", full_name: "Eve", email: "eve@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a6", registration_id: "r4", full_name: "Fay", email: "fay@x.test", assigned_table_number: null, cancelled_at: null },
    { id: "a7", registration_id: "r1", full_name: "Gus", email: "gus@x.test", assigned_table_number: null, cancelled_at: null },
  ],
});

describe("buildSeating", () => {
  it("lists live sponsored tables with tier, active guest count and overbooked flag", () => {
    const { tables } = buildSeating(rows());
    expect(tables).toEqual([
      { id: "t1", sponsorshipId: "s1", sponsorName: "Acme", tierName: "Gold", capacity: 2, guestCount: 3, overbooked: true, tableNumber: "12" },
      { id: "t2", sponsorshipId: "s2", sponsorName: "Bolt", tierName: "Silver", capacity: 2, guestCount: 0, overbooked: false, tableNumber: null },
    ]);
  });

  it("gives every guest their table's number unless they were moved", () => {
    const { guests } = buildSeating(rows());
    const byName = Object.fromEntries(guests.map((g) => [g.fullName, g]));
    expect(byName.Ann).toMatchObject({ sponsorName: "Acme", tierName: "Gold", tableNumber: "12", moved: false });
    expect(byName.Cat).toMatchObject({ tableNumber: "12", moved: false });
    expect(byName.Ben).toMatchObject({ tableNumber: "7", moved: true });
    expect(byName.Eve).toMatchObject({ sponsorName: null, tierName: "Silver", tableNumber: null, moved: false });
  });

  // QA #28: a full table (guests == capacity) is not overbooked; one more is.
  it("flags a table only when active guests exceed capacity", () => {
    const full = rows();
    full.tables[0].capacity = 3;
    expect(buildSeating(full).tables[0]).toMatchObject({ guestCount: 3, capacity: 3, overbooked: false });
    full.tables[0].capacity = 4;
    expect(buildSeating(full).tables[0]).toMatchObject({ guestCount: 3, overbooked: false });
    expect(buildSeating(rows()).tables[0]).toMatchObject({ guestCount: 3, capacity: 2, overbooked: true });
  });

  it("leaves out cancelled guests and guests of cancelled registrations", () => {
    const names = buildSeating(rows()).guests.map((g) => g.fullName);
    expect(names).toEqual(["Ann", "Ben", "Cat", "Eve", "Gus"]);
  });

  // Review #28 R2/R3: moving guests off a table is how an admin resolves overbooking.
  it("stops counting a guest toward their sponsored table once moved to another number", () => {
    const seated = rows();
    seated.attendees[1].assigned_table_number = null; // Ben back at table 12: 4 on a table of 2
    expect(buildSeating(seated).tables[0]).toMatchObject({ guestCount: 4, overbooked: true });

    seated.attendees[0].assigned_table_number = "7"; // Ann moved away
    seated.attendees[1].assigned_table_number = "8"; // Ben moved away
    expect(buildSeating(seated).tables[0]).toMatchObject({ guestCount: 2, capacity: 2, overbooked: false });
  });

  // QA v2: the admin overview's "Overbooked tables" must agree with this page.
  it("agrees with the admin overview on how many tables are overbooked after a move", () => {
    const seated = rows();
    seated.attendees[1].assigned_table_number = null; // Ben back at table 12: 4 on a table of 2
    seated.attendees[0].assigned_table_number = "7"; // Ann moved away
    seated.attendees[2].assigned_table_number = "8"; // Cat moved away
    const page = buildSeating(seated).tables.filter((t) => t.overbooked).length;
    const overview = computeOverview({
      payments: [],
      sponsorships: seated.sponsorships.map((s) => ({ id: s.id, status: s.status, pledged_cents: 0 })),
      tables: seated.tables,
      registrations: seated.registrations,
      attendees: seated.attendees,
    }).overbookedTables;
    expect(page).toBe(0);
    expect(overview).toBe(page);
  });

  it("still counts a guest moved to their own table's number", () => {
    const seated = rows();
    seated.attendees[1].assigned_table_number = "12";
    expect(buildSeating(seated).tables[0]).toMatchObject({ guestCount: 4 });
  });

  // Review #28 R7: a guest whose number equals their own table's never left it.
  it("does not mark a guest moved when their number is their own table's", () => {
    const seated = rows();
    seated.attendees[1].assigned_table_number = "12";
    const ben = buildSeating(seated).guests.find((g) => g.fullName === "Ben");
    expect(ben).toMatchObject({ tableNumber: "12", moved: false });
  });

  // Review #28 R6: a guest moved onto another sponsored table's number sits there.
  it("counts a guest moved onto another sponsored table's number at that table", () => {
    const seated = rows();
    seated.tables[1].physical_table_number = "7";
    seated.attendees[3].cancelled_at = null; // Dan sits at Bolt's table 7
    seated.attendees.push(
      { id: "a8", registration_id: "r2", full_name: "Hal", email: "hal@x.test", assigned_table_number: null, cancelled_at: null },
    );
    // Bolt's table 7 is full (Dan, Hal); Ben is moved onto 7 and Eve (individual) too.
    seated.attendees[4].assigned_table_number = "7";
    const bolt = buildSeating(seated).tables.find((t) => t.id === "t2");
    expect(bolt).toMatchObject({ guestCount: 4, capacity: 2, overbooked: true });
    // Acme's 12 loses Ben: Ann, Cat, Gus = 3 on 2.
    expect(buildSeating(seated).tables.find((t) => t.id === "t1")).toMatchObject({ guestCount: 3 });
  });

  it("does not count a moved guest at a cancelled sponsorship's table", () => {
    const seated = rows();
    seated.tables[2].physical_table_number = "7"; // t3 belongs to cancelled s3
    seated.tables[2].capacity = 0;
    const overview = computeOverview({
      payments: [],
      sponsorships: seated.sponsorships.map((s) => ({ id: s.id, status: s.status, pledged_cents: 0 })),
      tables: seated.tables,
      registrations: seated.registrations,
      attendees: seated.attendees,
    }).overbookedTables;
    expect(overview).toBe(buildSeating(seated).tables.filter((t) => t.overbooked).length);
  });

  it("agrees with the admin overview when guests move onto another table", () => {
    const seated = rows();
    seated.tables[0].capacity = 3; // Ann, Cat, Gus fill table 12
    seated.tables[1].physical_table_number = "7";
    seated.tables[1].capacity = 0;
    seated.attendees[0].assigned_table_number = "7"; // Ann onto Bolt's 7: 1 on 0
    seated.attendees[4].assigned_table_number = "12"; // Eve onto 12: 3 on 3
    const page = buildSeating(seated).tables.filter((t) => t.overbooked).map((t) => t.id);
    const overview = computeOverview({
      payments: [],
      sponsorships: seated.sponsorships.map((s) => ({ id: s.id, status: s.status, pledged_cents: 0 })),
      tables: seated.tables,
      registrations: seated.registrations,
      attendees: seated.attendees,
    }).overbookedTables;
    expect(page).toEqual(["t2"]);
    expect(overview).toBe(1);
  });
});

describe("parseTableNumber", () => {
  it("trims, and treats blank as clearing the number", () => {
    expect(parseTableNumber(" 12 ")).toEqual({ ok: true, value: "12" });
    expect(parseTableNumber("  ")).toEqual({ ok: true, value: "" });
    expect(parseTableNumber("VIP-1")).toEqual({ ok: true, value: "VIP-1" });
  });

  it("refuses long or odd values", () => {
    expect(parseTableNumber("12345678901").ok).toBe(false);
    expect(parseTableNumber("<b>").ok).toBe(false);
  });
});

describe("seatingErrorMessage", () => {
  it("names the archived and not-found cases", () => {
    expect(seatingErrorMessage({ code: "55000", message: "seating_archived" })).toMatch(/archived/);
    expect(seatingErrorMessage({ code: "P0002", message: "seating_not_found" })).toMatch(/no longer/);
    expect(seatingErrorMessage({ message: "boom" })).toMatch(/could not be saved/);
  });
});
