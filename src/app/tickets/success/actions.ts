"use server";

import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { loadTicketConfirmation } from "@/lib/tickets/confirmation";

// Polled by the success page while it waits for the Stripe webhook.
// Read only: returns the registration status of the caller's own order,
// or null when signed out or the session is not theirs.
export async function checkTicketStatus(sessionId: string): Promise<string | null> {
  if (typeof sessionId !== "string" || !sessionId) return null;
  const user = await getSessionUser();
  if (!user) return null;
  const order = await loadTicketConfirmation(createSupabaseAdminClient(), user.id, sessionId);
  return order?.status ?? null;
}
