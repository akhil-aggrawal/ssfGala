import { describe, expect, it } from "vitest";
import {
  formatUsd,
  hashInviteToken,
  inviteUrl,
  newInviteTokens,
  parsePledgeForm,
  pledgeErrorMessage,
  tableCents,
} from "./pledge";

const TIERS = [
  { id: "t-silver", name: "Silver" },
  { id: "t-gold", name: "Gold" },
  { id: "t-platinum", name: "Platinum" },
];

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("newInviteTokens", () => {
  it("makes one distinct token per table, each with its SHA-256 hash", () => {
    const tokens = newInviteTokens(3);
    expect(tokens).toHaveLength(3);
    expect(new Set(tokens.map((t) => t.token)).size).toBe(3);
    for (const t of tokens) {
      expect(t.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(t.hash).toBe(hashInviteToken(t.token));
      expect(t.hash).not.toContain(t.token);
    }
  });
});

describe("hashInviteToken", () => {
  it("is the SHA-256 hex digest", () => {
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("inviteUrl", () => {
  it("puts the raw token in the /invite link", () => {
    expect(inviteUrl("https://gala.example", "tok_1")).toBe("https://gala.example/invite/tok_1");
  });
});

describe("parsePledgeForm", () => {
  it("reads sponsor details and non-zero table counts by tier", () => {
    const parsed = parsePledgeForm(
      form({ display_name: " Acme Family ", email: "a@example.test", "Silver.tables": "1", "Gold.tables": "2", "Platinum.tables": "0" }),
      TIERS,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        display_name: "Acme Family",
        email: "a@example.test",
        tables: [
          { tier_id: "t-silver", tier_name: "Silver", count: 1 },
          { tier_id: "t-gold", tier_name: "Gold", count: 2 },
        ],
      },
    });
  });

  it("refuses a pledge with no tables", () => {
    const parsed = parsePledgeForm(form({ display_name: "A", email: "a@example.test", "Gold.tables": "0" }), TIERS);
    expect(parsed).toEqual({ ok: false, error: "Choose at least one table." });
  });

  it("refuses a missing name or a bad email", () => {
    expect(parsePledgeForm(form({ email: "a@example.test", "Gold.tables": "1" }), TIERS).ok).toBe(false);
    expect(parsePledgeForm(form({ display_name: "A", email: "nope", "Gold.tables": "1" }), TIERS).ok).toBe(false);
  });

  it("refuses counts that are not whole numbers", () => {
    for (const bad of ["-1", "1.5", "abc", "1000"]) {
      const parsed = parsePledgeForm(form({ display_name: "A", email: "a@example.test", "Gold.tables": bad }), TIERS);
      expect(parsed.ok).toBe(false);
    }
  });
});

describe("tableCents", () => {
  it("uses the tier sponsorship amount, else ten seats", () => {
    expect(tableCents({ sponsorship_amount_cents: 300000, seat_price_cents: 20000 })).toBe(300000);
    expect(tableCents({ sponsorship_amount_cents: null, seat_price_cents: 20000 })).toBe(200000);
  });
});

describe("formatUsd", () => {
  it("formats whole and part dollars", () => {
    expect(formatUsd(550000)).toBe("$5,500");
    expect(formatUsd(150050)).toBe("$1,500.50");
  });
});

describe("pledgeErrorMessage", () => {
  it("names the tier that ran out", () => {
    expect(pledgeErrorMessage({ code: "P0001", message: "pledge_inventory: Gold has 1 tables left" })).toBe(
      "Not enough Gold tables are left (1 available). Nothing was pledged.",
    );
  });

  it("explains a closed gala", () => {
    expect(pledgeErrorMessage({ code: "55000", message: "pledge_event_closed" })).toMatch(/not taking table pledges/);
  });

  it("falls back to a retry message", () => {
    expect(pledgeErrorMessage({ message: "boom" })).toBe("The pledge could not be saved. Try again. Nothing was pledged.");
  });
});
