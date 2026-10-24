"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { continuePath, loadTicketSale, parseSelection } from "@/lib/tickets/selection";

// Continue on /tickets. The tier and quantity are re-checked against the
// database here; a signed-out buyer goes through sign-in and comes back to
// /tickets with the same choice. Nothing is written yet.
export async function continueTickets(formData: FormData): Promise<void> {
  const sale = await loadTicketSale(createSupabaseAdminClient());
  const { tier, quantity } = parseSelection(
    { tier: formData.get("tier")?.toString(), quantity: formData.get("quantity")?.toString() },
    sale.tiers,
  );
  if (!sale.open || !tier) redirect("/tickets");
  const user = await getSessionUser();
  redirect(continuePath(user !== null, { tier, quantity }));
}
