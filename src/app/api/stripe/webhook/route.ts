import { loadTicketOrder, sendTicketConfirmation } from "@/lib/email/ticket-confirmation";
import { createEmailTransport } from "@/lib/email/transport";
import { createStripe } from "@/lib/stripe/server";
import { handleStripeWebhook, type CheckoutEventResult } from "@/lib/stripe/webhook";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

// POST /api/stripe/webhook. Stripe signs the exact bytes it sent, so the body
// is read as raw text and never parsed before verification.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const { status, body } = await handleStripeWebhook(rawBody, request.headers.get("stripe-signature"), {
    stripe: createStripe(),
    secret: process.env.STRIPE_WEBHOOK_SECRET,
    apply: async (args) => {
      const { data, error } = await createSupabaseAdminClient().rpc("apply_stripe_checkout_event", args);
      if (error) throw new Error(`apply_stripe_checkout_event failed: ${error.message}`);
      return data as CheckoutEventResult;
    },
    onConfirmed: async (sessionId) => {
      const order = await loadTicketOrder(createSupabaseAdminClient(), sessionId);
      if (order) await sendTicketConfirmation(order, createEmailTransport());
    },
  });
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
