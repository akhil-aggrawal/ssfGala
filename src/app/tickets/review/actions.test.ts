import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Action is reachable by a direct POST: it checks the session
// itself and passes only server values to the checkout.
const session = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
const checkout = vi.hoisted(() => ({ startTicketCheckout: vi.fn() }));

vi.mock("@/lib/auth/session", () => session);
vi.mock("@/lib/tickets/checkout", () => checkout);
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => "db" }));
vi.mock("@/lib/stripe/server", () => ({ stripeCheckout: () => "stripe" }));
vi.mock("@/lib/log", () => ({ log: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://gala.example.test" }) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

const { payWithStripe } = await import("./actions");

describe("payWithStripe", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    session.getSessionUser.mockReset().mockResolvedValue({ id: "user-1", email: "buyer@example.test" });
    checkout.startTicketCheckout.mockReset().mockResolvedValue({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/cs_1" });
  });

  it("sends a signed-out visitor to sign-in without touching Stripe", async () => {
    session.getSessionUser.mockResolvedValue(null);
    await expect(payWithStripe()).rejects.toThrow("REDIRECT /signin?next=%2Ftickets%2Freview");
    expect(checkout.startTicketCheckout).not.toHaveBeenCalled();
  });

  it("passes only the session buyer and origin, then redirects to the Stripe session", async () => {
    await expect(payWithStripe()).rejects.toThrow("REDIRECT https://checkout.stripe.com/c/pay/cs_1");
    expect(checkout.startTicketCheckout).toHaveBeenCalledWith("db", "stripe", {
      userId: "user-1",
      email: "buyer@example.test",
      origin: "https://gala.example.test",
    });
  });

  it("goes back to tickets when there is no pending order", async () => {
    checkout.startTicketCheckout.mockResolvedValue({ kind: "none" });
    await expect(payWithStripe()).rejects.toThrow("REDIRECT /tickets");
  });

  it("shows a plain message and does not redirect when Stripe or the database fails", async () => {
    checkout.startTicketCheckout.mockRejectedValue(new Error("stripe down"));
    await expect(payWithStripe()).resolves.toEqual({
      message: "We could not start the payment. You have not been charged. Try again.",
    });
  });
});
