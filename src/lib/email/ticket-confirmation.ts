// Ticket confirmation emails (issue #32). Server only.
// The Stripe webhook calls this once, right after the database first
// confirms a ticket payment; a replayed event never reaches it. A failed
// send is logged with the registration id and never undoes the confirmation.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { log } from "@/lib/log";
import { attendeeConfirmationEmail, receiptEmail, type TicketOrder } from "./templates";
import type { EmailTransport } from "./transport";

// The paid ticket order behind a Checkout Session. Null for any other
// payment (seat contributions, sponsorships) or an unknown session.
export async function loadTicketOrder(db: SupabaseClient<Database>, sessionId: string): Promise<TicketOrder | null> {
  const { data, error } = await db
    .from("payments")
    .select(
      "amount_cents, registrations!payments_registration_id_event_id_fkey (id, profiles!registrations_created_by_fkey (display_name, email), seating_tiers!registrations_tier_id_event_id_fkey (name), events!registrations_event_id_fkey (name, date_at, venue), attendees (full_name, email, created_at, cancelled_at))",
    )
    .eq("stripe_session_id", sessionId)
    .eq("purpose", "ticket")
    .eq("status", "succeeded")
    .maybeSingle();
  if (error) throw new Error(`loadTicketOrder failed: ${error.message}`);
  const reg = data?.registrations;
  if (!data || !reg) return null;
  return {
    registrationId: reg.id,
    buyerEmail: reg.profiles?.email ?? "",
    buyerName: reg.profiles?.display_name ?? null,
    amountCents: data.amount_cents,
    tier: reg.seating_tiers?.name ?? "",
    attendees: reg.attendees
      .filter((a) => a.cancelled_at === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => ({ name: a.full_name, email: a.email })),
    event: { name: reg.events?.name ?? "", dateAt: reg.events?.date_at ?? null, venue: reg.events?.venue ?? null },
  };
}

// One receipt to the buyer, one confirmation per attendee. Each send stands
// alone: one failure is logged and the rest still go out.
export async function sendTicketConfirmation(order: TicketOrder, transport: EmailTransport): Promise<void> {
  const sends: { kind: string; to: string; key: string; mail: ReturnType<typeof receiptEmail> }[] = [];
  if (order.buyerEmail) {
    sends.push({ kind: "receipt", to: order.buyerEmail, key: `receipt:${order.registrationId}`, mail: receiptEmail(order) });
  } else {
    log("error", "email: buyer has no email address", { registrationId: order.registrationId });
  }
  order.attendees.forEach((a, i) =>
    sends.push({
      kind: "confirmation",
      to: a.email,
      key: `confirmation:${order.registrationId}:${i}`,
      mail: attendeeConfirmationEmail(order, a),
    }),
  );

  for (const s of sends) {
    try {
      await transport.send({ to: s.to, idempotencyKey: s.key, ...s.mail });
    } catch (error) {
      log("error", "email: send failed", { registrationId: order.registrationId, kind: s.kind, error: String(error) });
    }
  }
}
