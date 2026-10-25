import { describe, expect, it, vi } from "vitest";
import type { CheckoutGateway, CheckoutSession } from "@/lib/tickets/checkout";
import {
  MAX_CONTRIBUTION_CENTS,
  MIN_CARD_CENTS,
  contributionSessionParams,
  formatDollars,
  parseContributionCents,
  startSeatContribution,
  suggestedTotalCents,
} from "./contribution";

describe("suggestedTotalCents", () => {
  it("is the tier's suggested amount × attendee count", () => {
    expect(suggestedTotalCents(20000, 3)).toBe(60000);
    expect(suggestedTotalCents(15000, 1)).toBe(15000);
  });
});

describe("formatDollars", () => {
  it("prints whole dollars without cents and keeps cents otherwise", () => {
    expect(formatDollars(60000)).toBe("600");
    expect(formatDollars(12345)).toBe("123.45");
    expect(formatDollars(50)).toBe("0.50");
    expect(formatDollars(0)).toBe("0");
  });
});

describe("parseContributionCents", () => {
  it("accepts $0 and any amount the guest types, in dollars", () => {
    expect(parseContributionCents("0")).toEqual({ ok: true, cents: 0 });
    expect(parseContributionCents("")).toEqual({ ok: true, cents: 0 });
    expect(parseContributionCents("600")).toEqual({ ok: true, cents: 60000 });
    expect(parseContributionCents("$1,250.5")).toEqual({ ok: true, cents: 125050 });
    expect(parseContributionCents(" 75.25 ")).toEqual({ ok: true, cents: 7525 });
    expect(parseContributionCents("0.50")).toEqual({ ok: true, cents: MIN_CARD_CENTS });
  });

  it("rejects negatives, text, fractions of a cent and amounts too big for Stripe", () => {
    for (const bad of ["-5", "abc", "1.234", "1e3", String(MAX_CONTRIBUTION_CENTS / 100 + 1)]) {
      expect(parseContributionCents(bad).ok).toBe(false);
    }
  });

  // QA (#21): both edges of the accepted range, one cent either side.
  it("accepts exactly $999,999.99 and $0.50 and rejects one cent past either edge", () => {
    expect(parseContributionCents("999999.99")).toEqual({ ok: true, cents: MAX_CONTRIBUTION_CENTS });
    expect(parseContributionCents("1,000,000").ok).toBe(false);
    expect(parseContributionCents(".5").ok).toBe(false);
    expect(parseContributionCents("0.5")).toEqual({ ok: true, cents: 50 });
    expect(parseContributionCents("0.49").ok).toBe(false);
    expect(parseContributionCents("0.01").ok).toBe(false);
  });

  it("rejects a card payment under Stripe's 50-cent minimum", () => {
    const r = parseContributionCents("0.25");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/\$0\.50/);
  });
});

const INPUT = {
  registrationId: "reg-1",
  eventId: "event-1",
  amountCents: 45000,
  tier: "Gold",
  email: "guest@example.test",
  origin: "https://gala.example.test",
};

describe("contributionSessionParams", () => {
  it("charges exactly the guest's amount as one seat_contribution line", () => {
    const params = contributionSessionParams(INPUT);
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([
      {
        price_data: {
          currency: "usd",
          unit_amount: 45000,
          product_data: { name: "Gold seat contribution — SSF Gala" },
        },
        quantity: 1,
      },
    ]);
    expect(params.client_reference_id).toBe("reg-1");
    expect(params.metadata).toEqual({ registration_id: "reg-1", event_id: "event-1", purpose: "seat_contribution" });
    expect(params.customer_email).toBe("guest@example.test");
    expect(params.success_url).toBe("https://gala.example.test/invite/contribution?status=paid");
    expect(params.cancel_url).toBe("https://gala.example.test/invite/contribution?status=cancelled");
  });
});

const session = (over: Partial<CheckoutSession> = {}): CheckoutSession => ({
  id: "cs_contrib",
  url: "https://checkout.stripe.com/c/pay/cs_contrib",
  status: "open",
  amount_total: 45000,
  ...over,
});

function gateway(created = session()) {
  return {
    create: vi.fn(async () => created),
    retrieve: vi.fn(async () => created),
    expire: vi.fn(async () => created),
  } satisfies CheckoutGateway;
}

function fakeDb(insertError: { message: string } | null = null) {
  const inserted: unknown[] = [];
  const client = {
    from: (table: string) => {
      if (table !== "payments") throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: unknown) => {
          inserted.push(row);
          return { error: insertError };
        },
      };
    },
  };
  return { client: client as never, inserted };
}

describe("startSeatContribution", () => {
  it("stores a pending seat_contribution payment for the session, then returns its URL", async () => {
    const db = fakeDb();
    const stripe = gateway();
    const url = await startSeatContribution(db.client, stripe, INPUT);
    expect(url).toBe("https://checkout.stripe.com/c/pay/cs_contrib");
    expect(stripe.create).toHaveBeenCalledWith(contributionSessionParams(INPUT), "seat-contribution-reg-1");
    expect(db.inserted).toEqual([
      {
        event_id: "event-1",
        registration_id: "reg-1",
        provider: "stripe",
        purpose: "seat_contribution",
        amount_cents: 45000,
        status: "pending",
        stripe_session_id: "cs_contrib",
      },
    ]);
  });

  it("refuses a zero or under-minimum amount without calling Stripe", async () => {
    const stripe = gateway();
    await expect(startSeatContribution(fakeDb().client, stripe, { ...INPUT, amountCents: 0 })).rejects.toThrow();
    await expect(startSeatContribution(fakeDb().client, stripe, { ...INPUT, amountCents: 49 })).rejects.toThrow();
    expect(stripe.create).not.toHaveBeenCalled();
  });

  it("throws when Stripe's amount differs, and stores nothing", async () => {
    const db = fakeDb();
    await expect(startSeatContribution(db.client, gateway(session({ amount_total: 100 })), INPUT)).rejects.toThrow(/amount/);
    expect(db.inserted).toEqual([]);
  });

  it("throws when the payment row cannot be stored, so the guest is never sent to pay", async () => {
    await expect(startSeatContribution(fakeDb({ message: "boom" }).client, gateway(), INPUT)).rejects.toThrow(/boom/);
  });
});
