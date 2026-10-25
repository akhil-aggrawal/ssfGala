import { describe, expect, it } from "vitest";
import { buildSponsorList, guestErrorMessage, parseGuestForm } from "./sponsors";
import type { SeatingTable } from "./seating";

const table = (over: Partial<SeatingTable>): SeatingTable => ({
  id: "t",
  sponsorshipId: "s1",
  sponsorName: "Acme",
  tierName: "Gold",
  capacity: 10,
  guestCount: 0,
  overbooked: false,
  tableNumber: null,
  ...over,
});

describe("buildSponsorList", () => {
  const sponsors = [
    { id: "sp1", display_name: "Acme", email: "acme@x.test" },
    { id: "sp2", display_name: "Bolt", email: "bolt@x.test" },
    { id: "sp3", display_name: "Aardvark", email: "a@x.test" },
  ];
  const sponsorships = [
    { id: "s1", sponsor_id: "sp1", pledged_cents: 200000, status: "committed" },
    { id: "s2", sponsor_id: "sp1", pledged_cents: 150000, status: "committed" },
    { id: "s3", sponsor_id: "sp2", pledged_cents: 250000, status: "cancelled" },
  ];
  const tables = [
    table({ id: "t1", sponsorshipId: "s1", guestCount: 11, overbooked: true }),
    table({ id: "t2", sponsorshipId: "s2", tierName: "Silver" }),
  ];

  it("shows each sponsor's pledged total and table count from committed pledges only", () => {
    const list = buildSponsorList(sponsors, sponsorships, tables);
    expect(list.map((s) => [s.name, s.pledgedCents, s.tableCount])).toEqual([
      ["Aardvark", 0, 0],
      ["Acme", 350000, 2],
      ["Bolt", 0, 0],
    ]);
  });

  it("lists each sponsor's tables with guests and the overbooked flag", () => {
    const acme = buildSponsorList(sponsors, sponsorships, tables).find((s) => s.name === "Acme")!;
    expect(acme.email).toBe("acme@x.test");
    expect(acme.tables.map((t) => [t.id, t.guestCount, t.overbooked])).toEqual([
      ["t1", 11, true],
      ["t2", 0, false],
    ]);
  });
});

describe("parseGuestForm", () => {
  const fd = (name: string, email: string) => {
    const f = new FormData();
    f.set("attendee_name", name);
    f.set("attendee_email", email);
    return f;
  };

  it("accepts one guest with a name and email", () => {
    expect(parseGuestForm(fd(" Ann ", "ann@x.test"))).toEqual({
      ok: true,
      attendees: [{ full_name: "Ann", email: "ann@x.test" }],
    });
  });

  it("refuses a missing name or a bad email", () => {
    expect(parseGuestForm(fd("", "ann@x.test")).ok).toBe(false);
    expect(parseGuestForm(fd("Ann", "not-an-email")).ok).toBe(false);
  });
});

describe("guestErrorMessage", () => {
  it("names a missing table and a closed gala in plain words", () => {
    expect(guestErrorMessage({ code: "P0002", message: "admin_guests_table_unknown" })).toMatch(/table/);
    expect(guestErrorMessage({ code: "55000", message: "sponsored_invite_closed" })).toMatch(/closed/);
    expect(guestErrorMessage({ message: "boom" })).toMatch(/Nothing was saved/);
  });
});
