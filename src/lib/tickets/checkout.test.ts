import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkoutSessionParams, startTicketCheckout, type CheckoutGateway, type CheckoutSession } from "./checkout";
import type { PendingOrder } from "./order";

const order = vi.hoisted(() => ({ loadPendingOrder: vi.fn() }));
vi.mock("./order", () => order);

const ORDER: PendingOrder = {
  registrationId: "reg-1",
  eventId: "event-1",
  tier: { name: "Gold", seatPriceCents: 20000 },
  attendees: [
    { full_name: "Asha Rao", email: "asha@example.test" },
    { full_name: "Ben Li", email: "ben@example.test" },
    { full_name: "Cara Dee", email: "cara@example.test" },
  ],
};
const BUYER = { userId: "user-1", email: "buyer@example.test", origin: "https://gala.example.test" };

type PaymentRow = { id: string; amount_cents: number; status: string; stripe_session_id: string | null };

// Supabase stand-in: `payments` select returns the given rows, and every
// upsert is recorded (or fails with `insertError`).
function fakeDb(rows: PaymentRow[] = [], insertError: { message: string } | null = null) {
  const inserted: unknown[][] = [];
  const filters: unknown[][] = [];
  const select = {
    eq: (...a: unknown[]) => (filters.push(a), select),
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  const client = {
    from: (table: string) => {
      if (table !== "payments") throw new Error(`unexpected table ${table}`);
      return {
        select: () => select,
        upsert: async (row: unknown, opts: unknown) => {
          inserted.push([row, opts]);
          return { error: insertError };
        },
      };
    },
  };
  return { client: client as never, inserted, filters };
}

const session = (over: Partial<CheckoutSession> = {}): CheckoutSession => ({
  id: "cs_new",
  url: "https://checkout.stripe.com/c/pay/cs_new",
  status: "open",
  amount_total: 60000,
  ...over,
});

function fakeGateway(existing?: CheckoutSession) {
  return {
    create: vi.fn(async () => session()),
    retrieve: vi.fn(async () => existing ?? session()),
    expire: vi.fn(async (id: string) => session({ id, status: "expired", url: null })),
  } satisfies CheckoutGateway;
}

describe("checkoutSessionParams", () => {
  it("prices one line item from the tier: seat price × attendee count", () => {
    const params = checkoutSessionParams(ORDER, BUYER);
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([
      {
        price_data: { currency: "usd", unit_amount: 20000, product_data: { name: "Gold seat — SSF Gala" } },
        quantity: 3,
      },
    ]);
    expect(params.client_reference_id).toBe("reg-1");
    expect(params.metadata).toEqual({ registration_id: "reg-1", event_id: "event-1", purpose: "ticket" });
    expect(params.customer_email).toBe("buyer@example.test");
  });

  it("returns to a read-only success page and back to review on cancel", () => {
    const params = checkoutSessionParams(ORDER, BUYER);
    expect(params.success_url).toBe("https://gala.example.test/tickets/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toBe("https://gala.example.test/tickets/cancelled");
  });

  it("leaves the email for Stripe to ask when the buyer has none", () => {
    expect(checkoutSessionParams(ORDER, { ...BUYER, email: null }).customer_email).toBeUndefined();
  });
});

describe("startTicketCheckout", () => {
  beforeEach(() => {
    order.loadPendingOrder.mockReset().mockResolvedValue(ORDER);
  });

  it("has nothing to pay when the buyer has no pending order", async () => {
    order.loadPendingOrder.mockResolvedValue(null);
    const gateway = fakeGateway();
    await expect(startTicketCheckout(fakeDb().client, gateway, BUYER)).resolves.toEqual({ kind: "none" });
    expect(gateway.create).not.toHaveBeenCalled();
  });

  it("creates a session priced on the server and stores a pending payment before redirecting", async () => {
    const db = fakeDb();
    const gateway = fakeGateway();
    const result = await startTicketCheckout(db.client, gateway, BUYER);

    expect(gateway.create).toHaveBeenCalledWith(
      checkoutSessionParams(ORDER, BUYER),
      expect.stringMatching(/^ticket-checkout-reg-1-0-[0-9a-f]{16}$/),
    );
    expect(db.inserted).toEqual([
      [
        {
          event_id: "event-1",
          registration_id: "reg-1",
          provider: "stripe",
          purpose: "ticket",
          amount_cents: 60000,
          status: "pending",
          stripe_session_id: "cs_new",
        },
        { onConflict: "stripe_session_id", ignoreDuplicates: true },
      ],
    ]);
    expect(result).toEqual({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/cs_new" });
    expect(db.filters).toContainEqual(["registration_id", "reg-1"]);
  });

  it("does not redirect when the pending payment could not be stored", async () => {
    const db = fakeDb([], { message: "boom" });
    await expect(startTicketCheckout(db.client, fakeGateway(), BUYER)).rejects.toThrow(/boom/);
  });

  it("refuses a session whose total does not match the server amount", async () => {
    const gateway = fakeGateway();
    gateway.create.mockResolvedValue(session({ amount_total: 100 }));
    const db = fakeDb();
    await expect(startTicketCheckout(db.client, gateway, BUYER)).rejects.toThrow(/amount/);
    expect(db.inserted).toEqual([]);
  });

  it("reuses the open session on a second click instead of creating another payment", async () => {
    const db = fakeDb([{ id: "pay-1", amount_cents: 60000, status: "pending", stripe_session_id: "cs_old" }]);
    const gateway = fakeGateway(session({ id: "cs_old", url: "https://checkout.stripe.com/c/pay/cs_old" }));
    const result = await startTicketCheckout(db.client, gateway, BUYER);

    expect(gateway.retrieve).toHaveBeenCalledWith("cs_old");
    expect(gateway.create).not.toHaveBeenCalled();
    expect(db.inserted).toEqual([]);
    expect(result).toEqual({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/cs_old" });
  });

  it("sends a buyer whose session is already paid to the success page, not to a new charge", async () => {
    const db = fakeDb([{ id: "pay-1", amount_cents: 60000, status: "pending", stripe_session_id: "cs_old" }]);
    const gateway = fakeGateway(session({ id: "cs_old", status: "complete", url: null }));
    const result = await startTicketCheckout(db.client, gateway, BUYER);

    expect(gateway.create).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "redirect", url: "https://gala.example.test/tickets/success?session_id=cs_old" });
  });

  it("expires an open session for an old amount, then starts a new one", async () => {
    const db = fakeDb([{ id: "pay-1", amount_cents: 40000, status: "pending", stripe_session_id: "cs_old" }]);
    const gateway = fakeGateway(session({ id: "cs_old", amount_total: 40000 }));
    const result = await startTicketCheckout(db.client, gateway, BUYER);

    expect(gateway.expire).toHaveBeenCalledWith("cs_old");
    expect(gateway.create).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^ticket-checkout-reg-1-1-/));
    expect(db.inserted).toHaveLength(1);
    expect(result).toEqual({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/cs_new" });
  });

  it("starts a new session when the last one expired", async () => {
    const db = fakeDb([{ id: "pay-1", amount_cents: 60000, status: "pending", stripe_session_id: "cs_old" }]);
    const gateway = fakeGateway(session({ id: "cs_old", status: "expired", url: null }));
    await startTicketCheckout(db.client, gateway, BUYER);

    expect(gateway.expire).not.toHaveBeenCalled();
    expect(gateway.create).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^ticket-checkout-reg-1-1-/));
  });

  it("retries the same attempt with the same idempotency key", async () => {
    const gateway = fakeGateway();
    await expect(startTicketCheckout(fakeDb([], { message: "boom" }).client, gateway, BUYER)).rejects.toThrow(/boom/);
    await startTicketCheckout(fakeDb().client, gateway, BUYER);

    const [first, second] = gateway.create.mock.calls.map((call) => (call as unknown[])[1]);
    expect(second).toBe(first);
  });

  // R1: Stripe rejects a reused key with different params for 24 h. If the
  // payment insert failed after Stripe created the session, no row was added,
  // so the next attempt has the same count; the key must still change when
  // the priced params change, or the buyer is locked out of paying.
  it("sends a new idempotency key when the order changed after a failed payment insert", async () => {
    const gateway = fakeGateway();
    await expect(startTicketCheckout(fakeDb([], { message: "boom" }).client, gateway, BUYER)).rejects.toThrow(/boom/);

    order.loadPendingOrder.mockResolvedValue({ ...ORDER, attendees: ORDER.attendees.slice(0, 2) });
    gateway.create.mockResolvedValue(session({ amount_total: 40000 }));
    await startTicketCheckout(fakeDb().client, gateway, BUYER);

    const [first, second] = gateway.create.mock.calls.map((call) => (call as unknown[])[1]);
    expect(second).not.toBe(first);
    expect(second).toMatch(/^ticket-checkout-reg-1-0-/);
  });
});
