import { describe, expect, it } from "vitest";
import {
  addAttendeesErrorMessage,
  attendeeErrorMessage,
  filterAttendees,
  parseAddAttendeesForm,
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

const TIER = "00000000-0000-0000-0000-0000000000f1";

function form(fields: Record<string, string>, people: [string, string][] = [["Asha Rao", "asha@example.test"]]) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ kind: "complimentary", tier_id: TIER, amount: "", ...fields })) fd.set(k, v);
  for (const [name, email] of people) {
    fd.append("attendee_name", name);
    fd.append("attendee_email", email);
  }
  return fd;
}

describe("parseAddAttendeesForm", () => {
  it("reads a complimentary registration with no amount", () => {
    expect(parseAddAttendeesForm(form({ amount: "100" }))).toEqual({
      ok: true,
      value: {
        kind: "complimentary",
        tier_id: TIER,
        attendees: [{ full_name: "Asha Rao", email: "asha@example.test" }],
        amount_cents: null,
      },
    });
  });

  it("reads a paid-offline amount in cents", () => {
    const parsed = parseAddAttendeesForm(form({ kind: "offline_paid", amount: "1,250.50" }));
    expect(parsed.ok && parsed.value.amount_cents).toBe(125050);
  });

  it("skips fully blank attendee rows", () => {
    const parsed = parseAddAttendeesForm(form({}, [["Asha Rao", "asha@example.test"], [" ", ""]]));
    expect(parsed.ok && parsed.value.attendees).toHaveLength(1);
  });

  // QA (issue #25): the 1-cent-per-attendee money guard at its boundary.
  it("accepts exactly 1 cent per attendee and rejects less", () => {
    const two: [string, string][] = [["Asha Rao", "asha@example.test"], ["Ben Li", "ben@example.test"]];
    expect(parseAddAttendeesForm(form({ kind: "offline_paid", amount: "0.01" }, two))).toEqual({
      ok: false,
      error: "Amount received must be at least 1 cent per attendee.",
    });
    const ok = parseAddAttendeesForm(form({ kind: "offline_paid", amount: "0.02" }, two));
    expect(ok.ok && ok.value.amount_cents).toBe(2);
  });

  it.each([
    [{ kind: "individual" }, undefined, "Choose Complimentary or Paid offline."],
    [{ tier_id: "gold" }, undefined, "Choose a tier."],
    [{ kind: "offline_paid", amount: "" }, undefined, "Amount received must be a dollar amount, like 200 or 200.50."],
    [{ kind: "offline_paid", amount: "0" }, undefined, "Amount received must be more than $0."],
    [{}, [] as [string, string][], "Add at least one attendee."],
    [{}, [["Asha Rao", ""]] as [string, string][], "Attendee 1 needs a name and an email."],
    [{}, [["Asha Rao", "not-an-email"]] as [string, string][], "Attendee 1 email is not valid."],
  ])("rejects %o", (fields, people, error) => {
    expect(parseAddAttendeesForm(form(fields, people))).toEqual({ ok: false, error });
  });
});

describe("addAttendeesErrorMessage", () => {
  it("names the archived and wrong-tier cases", () => {
    expect(addAttendeesErrorMessage({ code: "55000", message: "admin_attendees_archived" })).toMatch(/archived/);
    expect(addAttendeesErrorMessage({ code: "23503", message: "fk" })).toMatch(/tier/);
    expect(addAttendeesErrorMessage({ message: "boom" })).toBe("The attendees could not be added. Try again.");
  });
});
