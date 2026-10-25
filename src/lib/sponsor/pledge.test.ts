import { describe, expect, it, vi } from "vitest";
import {
  formatUsd,
  hashInviteToken,
  inviteUrl,
  newTableInvites,
  parsePledgeForm,
  pledgeErrorMessage,
  tableCents,
  tableInviteToken,
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

describe("newTableInvites", () => {
  it("makes one table id per table, its signed token and the token's SHA-256 hash", () => {
    const invites = newTableInvites(3, "s3cret");
    expect(invites).toHaveLength(3);
    expect(new Set(invites.map((t) => t.id)).size).toBe(3);
    expect(new Set(invites.map((t) => t.token)).size).toBe(3);
    for (const t of invites) {
      expect(t.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(t.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(t.token).toBe(tableInviteToken(t.id, "s3cret"));
      expect(t.hash).toBe(hashInviteToken(t.token));
      expect(t.hash).not.toContain(t.token);
    }
  });

  it("refuses to make links without INVITE_LINK_SECRET", () => {
    vi.stubEnv("INVITE_LINK_SECRET", "");
    expect(() => newTableInvites(1)).toThrow("INVITE_LINK_SECRET");
    vi.unstubAllEnvs();
  });
});

describe("tableInviteToken", () => {
  it("is HMAC-SHA256 of the table id, stable for the same id and secret", () => {
    const a = tableInviteToken("00000000-0000-0000-0000-000000000001", "s3cret");
    expect(a).toBe(tableInviteToken("00000000-0000-0000-0000-000000000001", "s3cret"));
    expect(a).not.toBe(tableInviteToken("00000000-0000-0000-0000-000000000002", "s3cret"));
    expect(a).not.toBe(tableInviteToken("00000000-0000-0000-0000-000000000001", "other"));
    // Pinned with: printf t | openssl dgst -sha256 -hmac key -binary | base64url
    expect(tableInviteToken("t", "key")).toBe("_UfQp2A4ysfnUp9_nJ88BatNxmx8eKOhRZO4NuZ28hc");
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
