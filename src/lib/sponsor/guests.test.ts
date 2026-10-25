import { describe, expect, it } from "vitest";
import { PAID_GUEST_TEXT, guestErrorMessage, parseGuestEdit, parseGuestId } from "./guests";

const ID = "00000000-0000-0000-0000-0000000002a1";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("parseGuestEdit", () => {
  it("trims the name and email", () => {
    expect(parseGuestEdit(form({ id: ID, full_name: " Ana Ray ", email: " ana@example.test " }))).toEqual({
      ok: true,
      value: { id: ID, full_name: "Ana Ray", email: "ana@example.test" },
    });
  });

  it.each([
    [{ id: "nope", full_name: "Ana", email: "ana@example.test" }, /Unknown guest/],
    [{ id: ID, full_name: "  ", email: "ana@example.test" }, /name/],
    [{ id: ID, full_name: "Ana", email: "not-an-email" }, /email/],
  ])("refuses %o", (fields, error) => {
    const result = parseGuestEdit(form(fields));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(error);
  });
});

describe("parseGuestId", () => {
  it("accepts a uuid only", () => {
    expect(parseGuestId(ID)).toBe(ID);
    expect(parseGuestId("1; drop table")).toBeNull();
  });
});

describe("guestErrorMessage", () => {
  it("explains a paid guest", () => {
    expect(guestErrorMessage({ code: "P0001", message: "sponsor_guest_paid" })).toBe(PAID_GUEST_TEXT);
  });

  it("does not say whether another sponsor's guest exists", () => {
    expect(guestErrorMessage({ code: "P0002", message: "sponsor_guest_not_found" })).toMatch(/no longer on your table/);
  });

  it("falls back to a retry message", () => {
    expect(guestErrorMessage({ message: "boom" })).toMatch(/Try again/);
  });
});
