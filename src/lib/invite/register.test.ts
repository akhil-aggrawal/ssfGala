import { describe, expect, it } from "vitest";
import { hashInviteToken } from "@/lib/sponsor/pledge";
import { MAX_GUESTS, parseGuestCount, parseGuests, registerErrorMessage, registerPath } from "./register";

function form(count: string | null, pairs: [string, string][]): FormData {
  const fd = new FormData();
  if (count !== null) fd.set("count", count);
  for (const [name, email] of pairs) {
    fd.append("attendee_name", name);
    fd.append("attendee_email", email);
  }
  return fd;
}

describe("parseGuestCount", () => {
  it("accepts 1 to MAX_GUESTS", () => {
    expect(parseGuestCount("1")).toBe(1);
    expect(parseGuestCount("4")).toBe(4);
    expect(parseGuestCount(String(MAX_GUESTS))).toBe(MAX_GUESTS);
  });
  it("rejects anything else", () => {
    for (const bad of [null, "", "0", "-1", "2.5", "abc", String(MAX_GUESTS + 1)]) {
      expect(parseGuestCount(bad)).toBeNull();
    }
  });
});

describe("parseGuests", () => {
  it("needs 4 name and email pairs for 4 attendees", () => {
    const four: [string, string][] = [
      ["Ann", "a@example.test"],
      [" Bo ", "b@example.test"],
      ["Cy", "c@example.test"],
      ["Di", "d@example.test"],
    ];
    const ok = parseGuests(form("4", four));
    expect(ok).toEqual({
      ok: true,
      attendees: [
        { full_name: "Ann", email: "a@example.test" },
        { full_name: "Bo", email: "b@example.test" },
        { full_name: "Cy", email: "c@example.test" },
        { full_name: "Di", email: "d@example.test" },
      ],
    });

    const short = parseGuests(form("4", four.slice(0, 3)));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors).toEqual({ "name-3": "Enter a name.", "email-3": "Enter an email address." });
  });

  it("flags a bad email and returns what was typed", () => {
    const res = parseGuests(form("1", [["Ann", "nope"]]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors["email-0"]).toMatch(/valid email/);
      expect(res.values).toEqual([{ full_name: "Ann", email: "nope" }]);
    }
  });

  it("refuses a missing or out-of-range count", () => {
    for (const count of [null, "0", "11"]) {
      const res = parseGuests(form(count, [["Ann", "a@example.test"]]));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toMatch(/number of attendees/);
    }
  });
});

describe("registerErrorMessage", () => {
  it("names each refusal in plain words", () => {
    expect(registerErrorMessage({ code: "55000", message: "" })).toMatch(/closed/);
    expect(registerErrorMessage({ code: "P0002", message: "" })).toMatch(/not valid/);
    expect(registerErrorMessage({ code: "22023", message: "" })).toMatch(/Check/);
    expect(registerErrorMessage({ message: "boom" })).toMatch(/Try again/);
  });
  it("never mentions capacity or overbooking", () => {
    for (const code of ["55000", "P0002", "22023", undefined]) {
      expect(registerErrorMessage({ code, message: "" })).not.toMatch(/full|capacity|overbook/i);
    }
  });
});

describe("registerPath", () => {
  it("is the invite path plus /register", () => {
    const token = "a".repeat(43);
    expect(registerPath(token)).toBe(`/invite/${token}/register`);
    expect(hashInviteToken(token)).toHaveLength(64);
  });
});
