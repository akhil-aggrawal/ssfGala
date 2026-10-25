import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { hashInviteToken } from "@/lib/sponsor/pledge";

// Table invite landing: turns the raw token in /invite/<token> into what the
// page shows. Read-only. Guests may be signed out and anon reads nothing
// under RLS, so the caller passes the service-role client; the lookup is by
// token hash only and returns just the sponsor name, tier, the tier's suggested
// per-seat contribution and event state.

export type Invite =
  | { kind: "invalid" }
  | { kind: "closed"; sponsorName: string; tier: string; eventName: string; suggestedCents: number }
  | { kind: "open"; sponsorName: string; tier: string; eventName: string; suggestedCents: number };

export type InviteRow = {
  seating_tiers: { name: string; suggested_contribution_cents: number };
  sponsorships: { status: string; sponsors: { display_name: string } };
  events: { name: string; status: string };
};

// Raw tokens are 32 random bytes in base64url (newInviteTokens).
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isTokenShape(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

// A cancelled sponsorship's link is no longer valid. Only an open event
// takes registrations; draft, closed and archived galas show the closed state.
export function toInvite(row: InviteRow | null): Invite {
  if (!row || row.sponsorships.status !== "committed") return { kind: "invalid" };
  const shown = {
    sponsorName: row.sponsorships.sponsors.display_name,
    tier: row.seating_tiers.name,
    eventName: row.events.name,
    suggestedCents: row.seating_tiers.suggested_contribution_cents,
  };
  return row.events.status === "open" ? { kind: "open", ...shown } : { kind: "closed", ...shown };
}

// A failed query throws; an unknown or malformed token is "invalid".
export async function loadInvite(client: SupabaseClient<Database>, token: string): Promise<Invite> {
  if (!isTokenShape(token)) return { kind: "invalid" };
  const { data, error } = await client
    .from("sponsored_tables")
    .select("seating_tiers!inner(name, suggested_contribution_cents), sponsorships!inner(status, sponsors!inner(display_name)), events!inner(name, status)")
    .eq("invite_token_hash", hashInviteToken(token))
    .maybeSingle();
  if (error) throw new Error(`loadInvite failed: ${error.message}`);
  return toInvite(data as unknown as InviteRow | null);
}

export function invitePath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}
