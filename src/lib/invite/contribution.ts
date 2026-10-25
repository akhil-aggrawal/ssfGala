// Optional seat contribution from an invited guest (issue #21). The guests
// are registered first; a positive amount then opens Stripe Checkout for a
// `seat_contribution` payment. Abandoning Checkout leaves them registered.
// Only the Stripe webhook marks the payment paid and allocates it to the
// registration's attendees (apply_stripe_checkout_event).
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { Database } from "@/lib/database.types";
import type { CheckoutGateway } from "@/lib/tickets/checkout";

// Stripe's smallest USD charge, and the largest amount every payment method
// accepts (8 digits in cents). https://docs.stripe.com/currencies
export const MIN_CARD_CENTS = 50;
export const MAX_CONTRIBUTION_CENTS = 99_999_999;

export type ContributionParse = { ok: true; cents: number } | { ok: false; message: string };

export function suggestedTotalCents(suggestedPerSeatCents: number, attendees: number): number {
  return suggestedPerSeatCents * attendees;
}

// Dollars for the amount field: "600", "123.45".
export function formatDollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

// The amount the guest typed, in dollars, to integer cents. Blank is $0.
export function parseContributionCents(raw: string | null | undefined): ContributionParse {
  const text = (raw ?? "").replace(/[\s$,]/g, "");
  if (text === "") return { ok: true, cents: 0 };
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return { ok: false, message: "Enter the contribution in dollars, like 150 or 150.00." };
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (cents > MAX_CONTRIBUTION_CENTS) return { ok: false, message: "Enter a contribution under $1,000,000." };
  if (cents > 0 && cents < MIN_CARD_CENTS) {
    return { ok: false, message: "Card payments start at $0.50. Enter $0 or at least $0.50." };
  }
  return { ok: true, cents };
}

export type ContributionInput = {
  registrationId: string;
  eventId: string;
  amountCents: number;
  tier: string;
  email: string | null;
  origin: string;
};

const returnUrl = (origin: string, status: "paid" | "cancelled") => `${origin}/invite/contribution?status=${status}`;

export function contributionSessionParams(input: ContributionInput): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: input.amountCents,
          product_data: { name: `${input.tier} seat contribution — SSF Gala` },
        },
        quantity: 1,
      },
    ],
    client_reference_id: input.registrationId,
    metadata: { registration_id: input.registrationId, event_id: input.eventId, purpose: "seat_contribution" },
    customer_email: input.email ?? undefined,
    // Neither page reads the session or changes anything: the webhook settles.
    success_url: returnUrl(input.origin, "paid"),
    cancel_url: returnUrl(input.origin, "cancelled"),
  };
}

// Open Checkout for a just-made registration. The registration is new, so one
// session per registration: the idempotency key is the registration id, and a
// retry gets the same session back. The pending payment row is stored before
// the guest is sent to Stripe; any failure throws and nothing redirects.
export async function startSeatContribution(
  db: SupabaseClient<Database>,
  stripe: CheckoutGateway,
  input: ContributionInput,
): Promise<string> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < MIN_CARD_CENTS || input.amountCents > MAX_CONTRIBUTION_CENTS) {
    throw new Error(`startSeatContribution: amount ${input.amountCents} is outside what Stripe can charge`);
  }
  const session = await stripe.create(contributionSessionParams(input), `seat-contribution-${input.registrationId}`);
  if (session.amount_total !== input.amountCents || !session.url) {
    throw new Error(`startSeatContribution: session amount ${session.amount_total} does not match ${input.amountCents}`);
  }

  const { error } = await db.from("payments").insert({
    event_id: input.eventId,
    registration_id: input.registrationId,
    provider: "stripe",
    purpose: "seat_contribution",
    amount_cents: input.amountCents,
    status: "pending",
    stripe_session_id: session.id,
  });
  if (error) throw new Error(`startSeatContribution: payment insert failed: ${error.message}`);
  return session.url;
}
