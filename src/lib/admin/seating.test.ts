import { describe, expect, it } from "vitest";
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
  ],
});

describe("buildSeating", () => {
  it("lists live sponsored tables with tier, active guest count and overbooked flag", () => {
    const { tables } = buildSeating(rows());
    expect(tables).toEqual([
      { id: "t1", sponsorName: "Acme", tierName: "Gold", capacity: 2, guestCount: 3, overbooked: true, tableNumber: "12" },
      { id: "t2", sponsorName: "Bolt", tierName: "Silver", capacity: 2, guestCount: 0, overbooked: false, tableNumber: null },
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

  it("leaves out cancelled guests and guests of cancelled registrations", () => {
    const names = buildSeating(rows()).guests.map((g) => g.fullName);
    expect(names).toEqual(["Ann", "Ben", "Cat", "Eve"]);
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
