// Ticket flow, screen E: after Stripe. The success page reads the buyer's
// registration through the Stripe session id; only the Stripe webhook moves
// it from pending_payment to registered. Nothing here writes, and nothing
// carries a table number: admins send those later.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type TicketConfirmation = { status: string; tier: string; attendees: string[] };

export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 60000;

// The buyer's ticket order paid (or being paid) in this Checkout Session.
// Null when the session is unknown or belongs to someone else. A failed
// query throws so an outage never reads as "no order".
export async function loadTicketConfirmation(
  db: SupabaseClient<Database>,
  userId: string,
  sessionId: string,
): Promise<TicketConfirmation | null> {
  if (!sessionId) return null;
  const { data, error } = await db
    .from("payments")
    .select(
      "registrations!payments_registration_id_event_id_fkey (status, created_by, seating_tiers!registrations_tier_id_event_id_fkey (name), attendees (full_name, created_at, cancelled_at))",
    )
    .eq("stripe_session_id", sessionId)
    .eq("purpose", "ticket")
    .maybeSingle();
  if (error) throw new Error(`loadTicketConfirmation failed: ${error.message}`);
  const reg = data?.registrations;
  if (!reg || reg.created_by !== userId) return null;
  return {
    status: reg.status,
    tier: reg.seating_tiers?.name ?? "",
    attendees: reg.attendees
      .filter((a) => a.cancelled_at === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((a) => a.full_name),
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}

// Checks the status every 2 s until it is registered, for up to 60 s.
// A failed check (offline, server busy) counts as still waiting.
export async function waitForConfirmation(
  check: () => Promise<string | null>,
  signal?: AbortSignal,
): Promise<"registered" | "timeout" | "aborted"> {
  for (let waited = 0; waited < POLL_TIMEOUT_MS; waited += POLL_INTERVAL_MS) {
    await sleep(POLL_INTERVAL_MS, signal);
    if (signal?.aborted) return "aborted";
    const status = await check().catch(() => null);
    if (status === "registered") return "registered";
  }
  return "timeout";
}
