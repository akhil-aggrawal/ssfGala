import { describe, expect, it } from "vitest";
import { addAttendeesErrorMessage, parseAddAttendeesForm } from "./attendees";

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
