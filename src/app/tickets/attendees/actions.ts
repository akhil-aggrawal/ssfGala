"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { parseAttendees, saveOrderErrorMessage, type AttendeeErrors, type AttendeeInput } from "@/lib/tickets/order";
import { loadTicketSale, parseSelection } from "@/lib/tickets/selection";

export type AttendeesState = { values: AttendeeInput[]; errors: AttendeeErrors; message: string } | null;

// Review on /tickets/attendees. The buyer comes from the session and the tier
// and quantity are re-checked against the open gala; nothing in the form is
// trusted. save_pending_ticket_order keeps one pending order per buyer, so
// going back and resubmitting edits it instead of adding another.
export async function saveAttendees(_prev: AttendeesState, formData: FormData): Promise<AttendeesState> {
  const user = await getSessionUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent("/tickets")}`);

  const db = createSupabaseAdminClient();
  const sale = await loadTicketSale(db);
  const { tier, quantity } = parseSelection(
    { tier: formData.get("tier")?.toString(), quantity: formData.get("quantity")?.toString() },
    sale.tiers,
  );
  if (!sale.open || !tier) redirect("/tickets");

  const parsed = parseAttendees(formData, quantity);
  if (!parsed.ok) {
    return { values: parsed.values, errors: parsed.errors, message: "Fix the highlighted fields. Nothing was saved." };
  }

  const { error } = await db.rpc("save_pending_ticket_order", {
    p_user_id: user.id,
    p_tier_name: tier.name,
    p_attendees: parsed.attendees,
  });
  if (error) return { values: parsed.attendees, errors: {}, message: saveOrderErrorMessage(error) };

  redirect("/tickets/review");
}
