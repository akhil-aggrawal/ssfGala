import { describe, expect, it } from "vitest";
import {
  attendeeErrorMessage,
  filterAttendees,
  parseAttendeeEdit,
  parseFilters,
  type AttendeeRow,
} from "./attendees";

const row = (over: Partial<AttendeeRow>): AttendeeRow => ({
  id: "a",
  fullName: "Ann Lee",
  email: "ann@example.test",
  cancelled: false,
  kind: "individual",
  tier: "Gold",
  table: null,
  paid: false,
  ...over,
});

const rows = [
  row({ id: "1", fullName: "Ann Lee", email: "ann@example.test", tier: "Gold", paid: true }),
  row({ id: "2", fullName: "Raj Patel", email: "raj@corp.test", tier: "Silver", kind: "sponsored", table: "7" }),
  row({ id: "3", fullName: "Mary Ann Cho", email: "mcho@example.test", cancelled: true }),
];
const ids = (list: AttendeeRow[]) => list.map((r) => r.id);

describe("filterAttendees", () => {
  it("matches a partial name or email, ignoring case", () => {
    expect(ids(filterAttendees(rows, parseFilters({ q: "ANN" })))).toEqual(["1"]);
    expect(ids(filterAttendees(rows, parseFilters({ q: "corp" })))).toEqual(["2"]);
  });

  it("hides cancelled attendees unless asked", () => {
    expect(ids(filterAttendees(rows, parseFilters({})))).toEqual(["1", "2"]);
    expect(ids(filterAttendees(rows, parseFilters({ q: "ann", cancelled: "1" })))).toEqual(["1", "3"]);
  });

  it("filters by tier, kind, table and paid", () => {
    expect(ids(filterAttendees(rows, parseFilters({ tier: "Silver" })))).toEqual(["2"]);
    expect(ids(filterAttendees(rows, parseFilters({ kind: "sponsored" })))).toEqual(["2"]);
    expect(ids(filterAttendees(rows, parseFilters({ table: " 7 " })))).toEqual(["2"]);
    expect(ids(filterAttendees(rows, parseFilters({ paid: "yes" })))).toEqual(["1"]);
    expect(ids(filterAttendees(rows, parseFilters({ paid: "no" })))).toEqual(["2"]);
  });
});

describe("parseFilters", () => {
  it("ignores unknown values and repeated params", () => {
    expect(parseFilters({ tier: "Bronze", kind: "vip", paid: "maybe", q: ["a", "b"] })).toEqual({
      q: "a",
      tier: "",
      kind: "",
      table: "",
      paid: "",
      cancelled: false,
    });
  });
});

describe("parseAttendeeEdit", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const id = "00000000-0000-0000-0000-000000000001";

  it("trims name and email", () => {
    expect(parseAttendeeEdit(form({ attendee_id: id, full_name: " Ann ", email: " ann@example.test " }))).toEqual({
      ok: true,
      value: { attendeeId: id, fullName: "Ann", email: "ann@example.test" },
    });
  });

  it("refuses a bad id, a blank name or a bad email", () => {
    expect(parseAttendeeEdit(form({ attendee_id: "x", full_name: "A", email: "a@b.test" })).ok).toBe(false);
    expect(parseAttendeeEdit(form({ attendee_id: id, full_name: " ", email: "a@b.test" })).ok).toBe(false);
    expect(parseAttendeeEdit(form({ attendee_id: id, full_name: "A", email: "not-an-email" })).ok).toBe(false);
  });
});

describe("attendeeErrorMessage", () => {
  it("names each refusal in plain words", () => {
    expect(attendeeErrorMessage({ code: "P0002", message: "attendee_not_found" })).toMatch(/no longer/);
    expect(attendeeErrorMessage({ code: "55000", message: "attendee_event_read_only" })).toMatch(/read-only/);
    expect(attendeeErrorMessage({ code: "P0001", message: "attendee_already_cancelled" })).toMatch(/already cancelled/);
    expect(attendeeErrorMessage({ message: "boom" })).toMatch(/Try again/);
  });
});
