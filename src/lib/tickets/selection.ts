// Ticket flow, screen A: tier + quantity choice, order total, and where
// Continue goes. Pure functions plus one read; money stays in integer cents.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type TicketTier = { name: string; seatPriceCents: number };
export type Selection = { tier: TicketTier | null; quantity: number };
export type TicketSale = { open: boolean; tiers: TicketTier[] };

// One buyer may order up to a full table of seats at once.
export const MAX_TICKETS = 10;

export function orderTotalCents(tier: TicketTier, quantity: number): number {
  return tier.seatPriceCents * quantity;
}

// 15000 → "$150", 60150 → "$601.50".
export function formatUsd(cents: number): string {
  const dollars = Math.trunc(cents / 100).toLocaleString("en-US");
  const rest = cents % 100;
  return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, "0")}`;
}

// A choice from the URL or a form. Unknown tiers and out-of-range
// quantities are dropped, never trusted.
export function parseSelection(
  input: { tier?: string | null; quantity?: string | null },
  tiers: readonly TicketTier[],
): Selection {
  const tier = tiers.find((t) => t.name === input.tier) ?? null;
  const n = /^\d{1,2}$/.test(input.quantity ?? "") ? Number(input.quantity) : 0;
  return { tier, quantity: n >= 1 && n <= MAX_TICKETS ? n : 1 };
}

const query = (tier: TicketTier, quantity: number) =>
  new URLSearchParams({ tier: tier.name, quantity: String(quantity) }).toString();

// Signed in → attendee details. Signed out → sign-in, then back to /tickets
// with the same choice in the URL.
export function continuePath(signedIn: boolean, { tier, quantity }: { tier: TicketTier; quantity: number }): string {
  if (signedIn) return `/tickets/attendees?${query(tier, quantity)}`;
  return `/signin?next=${encodeURIComponent(`/tickets?${query(tier, quantity)}`)}`;
}

// The active gala's tiers, read from the database. Tickets are on sale only
// while it is `open`; a draft or no gala reads as closed. A failed query
// throws so an outage never reads as "sales closed".
export async function loadTicketSale(db: SupabaseClient<Database>): Promise<TicketSale> {
  const { data, error } = await db
    .from("events")
    .select("status, seating_tiers (name, seat_price_cents)")
    .in("status", ["draft", "open"])
    .maybeSingle();
  if (error) throw new Error(`loadTicketSale failed: ${error.message}`);
  if (data?.status !== "open") return { open: false, tiers: [] };
  const tiers = data.seating_tiers
    .map((t) => ({ name: t.name, seatPriceCents: t.seat_price_cents }))
    .sort((a, b) => a.seatPriceCents - b.seatPriceCents);
  return { open: true, tiers };
}
