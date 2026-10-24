// Stripe on the server. Server only: the secret key never reaches the browser.
import Stripe from "stripe";
import type { CheckoutGateway } from "@/lib/tickets/checkout";

export function createStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY must be set");
  return new Stripe(key);
}

export function stripeCheckout(stripe: Stripe = createStripe()): CheckoutGateway {
  return {
    create: (params, idempotencyKey) => stripe.checkout.sessions.create(params, { idempotencyKey }),
    retrieve: (id) => stripe.checkout.sessions.retrieve(id),
    expire: (id) => stripe.checkout.sessions.expire(id),
  };
}
