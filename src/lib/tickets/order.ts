// Ticket flow, screens B and C: attendee details and the pending order.
// Pure functions plus one read; the Server Action in app/tickets/attendees
// does the write through save_pending_ticket_order.
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL, type AttendeeInput } from "@/lib/admin/attendees";
import type { Database } from "@/lib/database.types";
import { parseSelection, type Selection, type TicketTier } from "./selection";

export type { AttendeeInput };
export type PendingOrder = { tier: TicketTier; attendees: AttendeeInput[] };

// Field keys: `name-<i>` and `email-<i>`, 0-based, one pair per ticket.
export type AttendeeErrors = Record<string, string>;
export type AttendeesParse =
  | { ok: true; attendees: AttendeeInput[] }
  | { ok: false; errors: AttendeeErrors; values: AttendeeInput[] };

// One name and email pair per ticket. Every bad field gets its own message,
// and what was typed comes back so the form can show it again.
export function parseAttendees(fd: FormData, quantity: number): AttendeesParse {
  const names = fd.getAll("attendee_name");
  const emails = fd.getAll("attendee_email");
  const values: AttendeeInput[] = [];
  const errors: AttendeeErrors = {};
  for (let i = 0; i < quantity; i++) {
    const full_name = (names[i]?.toString() ?? "").trim();
    const email = (emails[i]?.toString() ?? "").trim();
    values.push({ full_name, email });
    if (!full_name) errors[`name-${i}`] = "Enter a name.";
    if (!email) errors[`email-${i}`] = "Enter an email address.";
    else if (!EMAIL.test(email)) errors[`email-${i}`] = "Enter a valid email address, like name@example.com.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };
  return { ok: true, attendees: values };
}

// What the attendee screen shows: the tier and quantity from the URL, or,
// when the URL has none (back from review), the buyer's pending order.
export function attendeeStep(
  params: { tier?: string | null; quantity?: string | null },
  tiers: readonly TicketTier[],
  pending: PendingOrder | null,
): (Selection & { tier: TicketTier }) | null {
  const choice = parseSelection(params, tiers);
  if (choice.tier) return { tier: choice.tier, quantity: choice.quantity };
  const tier = pending ? tiers.find((t) => t.name === pending.tier.name) : undefined;
  if (!pending || !tier) return null;
  return { tier, quantity: pending.attendees.length };
}

// The buyer's unpaid individual order for the open gala, with its live
// (not cancelled) attendees in the order they were entered. Null when there
// is none. A failed query throws so an outage never reads as "no order".
export async function loadPendingOrder(db: SupabaseClient<Database>, userId: string): Promise<PendingOrder | null> {
  const { data, error } = await db
    .from("registrations")
    .select(
      "id, seating_tiers!registrations_tier_id_event_id_fkey (name, seat_price_cents), events!registrations_event_id_fkey!inner (status), attendees (full_name, email, created_at, cancelled_at)",
    )
    .eq("created_by", userId)
    .eq("kind", "individual")
    .eq("status", "pending_payment")
    .eq("events.status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`loadPendingOrder failed: ${error.message}`);
  if (!data?.seating_tiers) return null;
  const attendees = data.attendees
    .filter((a) => a.cancelled_at === null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(({ full_name, email }) => ({ full_name, email }));
  if (attendees.length === 0) return null;
  return {
    tier: { name: data.seating_tiers.name, seatPriceCents: data.seating_tiers.seat_price_cents },
    attendees,
  };
}

// Plain-words text for a failed save_pending_ticket_order call.
export function saveOrderErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "55000") return "Ticket sales are closed right now. Nothing was saved.";
  if (error.code === "22023") return "Check the attendee details and tier. Nothing was saved.";
  return "Your details could not be saved. Try again.";
}
