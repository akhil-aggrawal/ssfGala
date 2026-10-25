// Ticket flow, screen D: pay for the pending order with Stripe Checkout.
// The amount is the tier's seat price × live attendees, read on the server;
// nothing from the browser is priced. This only starts a payment: the
// Stripe webhook alone marks it paid and confirms the registration.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { Database } from "@/lib/database.types";
import { loadPendingOrder, type PendingOrder } from "./order";
import { orderTotalCents } from "./selection";

export type CheckoutSession = Pick<Stripe.Checkout.Session, "id" | "url" | "status" | "amount_total">;

// The three Stripe calls this flow makes. The real one wraps the Stripe SDK
// (lib/stripe/server.ts); tests pass a fake.
export interface CheckoutGateway {
  create(params: Stripe.Checkout.SessionCreateParams, idempotencyKey: string): Promise<CheckoutSession>;
  retrieve(sessionId: string): Promise<CheckoutSession>;
  expire(sessionId: string): Promise<CheckoutSession>;
}

export type Buyer = { userId: string; email: string | null; origin: string };
export type CheckoutResult = { kind: "redirect"; url: string } | { kind: "none" };

const successUrl = (origin: string, sessionId: string) =>
  `${origin}/tickets/success?session_id=${sessionId}`;

export function checkoutSessionParams(order: PendingOrder, buyer: Buyer): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: order.tier.seatPriceCents,
          product_data: { name: `${order.tier.name} seat — SSF Gala` },
        },
        quantity: order.attendees.length,
      },
    ],
    client_reference_id: order.registrationId,
    metadata: { registration_id: order.registrationId, event_id: order.eventId, purpose: "ticket" },
    customer_email: buyer.email ?? undefined,
    // Stripe fills {CHECKOUT_SESSION_ID}. The page there only reads.
    success_url: successUrl(buyer.origin, "{CHECKOUT_SESSION_ID}"),
    // Back from Stripe without paying: Try again reuses this same order.
    cancel_url: `${buyer.origin}/tickets/cancelled`,
  };
}

// Pay for the buyer's pending order. A second click reuses the open session
// for the same amount. An open session for an old amount (attendees changed)
// is expired first so it can never be paid. The pending payment row is stored
// before the buyer is sent to Stripe; any failure throws and nothing redirects.
export async function startTicketCheckout(
  db: SupabaseClient<Database>,
  stripe: CheckoutGateway,
  buyer: Buyer,
): Promise<CheckoutResult> {
  const order = await loadPendingOrder(db, buyer.userId);
  if (!order) return { kind: "none" };
  const amount = orderTotalCents(order.tier, order.attendees.length);

  const { data: payments, error } = await db
    .from("payments")
    .select("id, amount_cents, status, stripe_session_id")
    .eq("registration_id", order.registrationId)
    .eq("provider", "stripe")
    .eq("purpose", "ticket")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`startTicketCheckout: payments read failed: ${error.message}`);

  const last = payments[0];
  if (last?.status === "pending" && last.stripe_session_id) {
    const open = await stripe.retrieve(last.stripe_session_id);
    if (open.status === "complete") return { kind: "redirect", url: successUrl(buyer.origin, open.id) };
    if (open.status === "open") {
      if (open.url && last.amount_cents === amount && open.amount_total === amount) {
        return { kind: "redirect", url: open.url };
      }
      await stripe.expire(open.id);
    }
  }

  // One key per attempt and params: a retry or a double click of the same
  // attempt gets the same session back from Stripe instead of a second one.
  // The params hash matters when a session was created but its payment row
  // was not stored: the count stays the same, and Stripe refuses a reused key
  // with different params for 24 h, so a changed order must get a new key.
  const params = checkoutSessionParams(order, buyer);
  const paramsHash = createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 16);
  const session = await stripe.create(params, `ticket-checkout-${order.registrationId}-${payments.length}-${paramsHash}`);
  if (session.amount_total !== amount || !session.url) {
    throw new Error(`startTicketCheckout: session amount ${session.amount_total} does not match ${amount}`);
  }

  const { error: insertError } = await db.from("payments").upsert(
    {
      event_id: order.eventId,
      registration_id: order.registrationId,
      provider: "stripe",
      purpose: "ticket",
      amount_cents: amount,
      status: "pending",
      stripe_session_id: session.id,
    },
    { onConflict: "stripe_session_id", ignoreDuplicates: true },
  );
  if (insertError) throw new Error(`startTicketCheckout: payment insert failed: ${insertError.message}`);

  return { kind: "redirect", url: session.url };
}
