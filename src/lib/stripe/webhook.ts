// Stripe webhook: the only source of payment truth. Server only.
// Verifies the Stripe signature over the raw body, then hands the signed
// Checkout Session fields to apply_stripe_checkout_event, which dedupes by
// event id and settles the payment in one transaction.
import type Stripe from "stripe";
import { log } from "@/lib/log";

export type CheckoutEventArgs = {
  p_event_id: string;
  p_event_type: string;
  p_session_id: string;
  p_payment_status: string;
  p_amount_total: number;
  p_payment_intent_id?: string;
};

export type CheckoutEventResult = { outcome: string; expected_cents?: number };

export type WebhookDeps = {
  stripe: Stripe;
  secret: string | undefined;
  apply: (args: CheckoutEventArgs) => Promise<CheckoutEventResult>;
  // Runs once, when the database first confirms the payment (never on a
  // replay). Its failure is logged and never changes the 200 answer.
  onConfirmed?: (sessionId: string) => Promise<void>;
};

export type WebhookResponse = { status: number; body: { received: true } | { error: string } };

const SESSION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
  deps: WebhookDeps,
): Promise<WebhookResponse> {
  if (!deps.secret) {
    log("error", "stripe webhook: STRIPE_WEBHOOK_SECRET is not set");
    return { status: 500, body: { error: "not configured" } };
  }
  if (!signature) return { status: 400, body: { error: "missing signature" } };

  let event: Stripe.Event;
  try {
    event = deps.stripe.webhooks.constructEvent(rawBody, signature, deps.secret);
  } catch (error) {
    log("warn", "stripe webhook: signature verification failed", { error: String(error) });
    return { status: 400, body: { error: "invalid signature" } };
  }

  if (!SESSION_EVENTS.has(event.type)) return { status: 200, body: { received: true } };

  const session = event.data.object as Stripe.Checkout.Session;
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const args: CheckoutEventArgs = {
    p_event_id: event.id,
    p_event_type: event.type,
    p_session_id: session.id,
    p_payment_status: session.payment_status,
    p_amount_total: session.amount_total ?? 0,
    ...(intent ? { p_payment_intent_id: intent } : {}),
  };

  let result: CheckoutEventResult;
  try {
    result = await deps.apply(args);
  } catch (error) {
    // Nothing was recorded (one transaction), so Stripe's retry is processed.
    log("error", "stripe webhook: processing failed", { eventId: event.id, sessionId: session.id, error: String(error) });
    return { status: 500, body: { error: "processing failed" } };
  }

  if (result.outcome === "amount_mismatch") {
    log("error", "stripe webhook: paid amount does not match the order", {
      eventId: event.id,
      sessionId: session.id,
      expectedCents: result.expected_cents,
      paidCents: session.amount_total,
    });
  } else if (result.outcome === "unknown_session") {
    log("warn", "stripe webhook: no stored payment for this session", { eventId: event.id, sessionId: session.id });
  } else {
    if (result.outcome === "confirmed" && deps.onConfirmed) {
      try {
        await deps.onConfirmed(session.id);
      } catch (error) {
        log("error", "stripe webhook: post-confirmation step failed", { eventId: event.id, sessionId: session.id, error: String(error) });
      }
    }
    log("info", "stripe webhook: processed", { eventId: event.id, type: event.type, sessionId: session.id, outcome: result.outcome });
  }
  return { status: 200, body: { received: true } };
}
