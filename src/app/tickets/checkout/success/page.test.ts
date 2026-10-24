import { describe, expect, it, vi } from "vitest";

// Returning to the success URL must not change anything: only the Stripe
// webhook confirms a payment. The page may not reach the database or Stripe.
const db = vi.hoisted(() => vi.fn());
const stripe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: db, createSupabaseServerClient: db }));
vi.mock("@/lib/stripe/server", () => ({ createStripe: stripe, stripeCheckout: stripe }));

const { default: CheckoutSuccessPage } = await import("./page");

describe("CheckoutSuccessPage", () => {
  it("renders without touching the database or Stripe", () => {
    expect(CheckoutSuccessPage()).toBeTruthy();
    expect(db).not.toHaveBeenCalled();
    expect(stripe).not.toHaveBeenCalled();
  });
});
