import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Sponsor table pledges: form parsing, invite tokens and error text for
// /sponsor. Server only (node:crypto); the Server Action does the I/O.

export type PledgeTier = { id: string; name: string };
export type PledgeTable = { tier_id: string; tier_name: string; count: number };
export type PledgeInput = { display_name: string; email: string; tables: PledgeTable[] };
export type InviteToken = { token: string; hash: string };

// SHA-256 hex. Only this is stored; the raw token lives in the link.
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// 256 random bits per table, URL-safe.
export function newInviteTokens(count: number): InviteToken[] {
  return Array.from({ length: count }, () => {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: hashInviteToken(token) };
  });
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin}/invite/${token}`;
}

// What one table costs: the tier's sponsorship amount, else ten seats.
// Mirrors pledge_sponsorship(), which computes the stored amount.
export function tableCents(tier: { sponsorship_amount_cents: number | null; seat_price_cents: number }): number {
  return tier.sponsorship_amount_cents ?? tier.seat_price_cents * 10;
}

export { formatUsd } from "./format";

export type PledgeParse = { ok: true; value: PledgeInput } | { ok: false; error: string };

const text = (fd: FormData, key: string) => (fd.get(key)?.toString() ?? "").trim();

export function parsePledgeForm(fd: FormData, tiers: readonly PledgeTier[]): PledgeParse {
  const fail = (error: string): PledgeParse => ({ ok: false, error });

  const display_name = text(fd, "display_name");
  if (!display_name) return fail("Sponsor name is required.");
  const email = text(fd, "email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.");

  const tables: PledgeTable[] = [];
  for (const tier of tiers) {
    const raw = text(fd, `${tier.name}.tables`) || "0";
    if (!/^\d{1,3}$/.test(raw)) return fail(`${tier.name} tables must be a whole number from 0 to 999.`);
    const count = Number(raw);
    if (count > 0) tables.push({ tier_id: tier.id, tier_name: tier.name, count });
  }
  if (tables.length === 0) return fail("Choose at least one table.");

  return { ok: true, value: { display_name, email, tables } };
}

// Plain-words text for a failed pledge_sponsorship call.
export function pledgeErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "P0001") {
    const m = /pledge_inventory: (\w+) has (\d+) tables left/.exec(error.message);
    if (m) return `Not enough ${m[1]} tables are left (${m[2]} available). Nothing was pledged.`;
  }
  if (error.code === "55000") return "The gala is not taking table pledges right now. Nothing was pledged.";
  return "The pledge could not be saved. Try again. Nothing was pledged.";
}

export type PledgeTierRow = PledgeTier & {
  seat_price_cents: number;
  sponsorship_amount_cents: number | null;
  tables_left: number;
};

const TIER_ORDER = ["Silver", "Gold", "Platinum"];

// The active gala's tiers with tables still free (committed pledges only).
// Takes the service-role client. Display only: pledge_sponsorship re-checks
// inventory under a lock. A failed query throws.
export async function loadPledgeTiers(
  admin: SupabaseClient<Database>,
  eventId: string,
): Promise<PledgeTierRow[]> {
  const [tiers, taken] = await Promise.all([
    admin
      .from("seating_tiers")
      .select("id, name, seat_price_cents, sponsorship_amount_cents, table_inventory")
      .eq("event_id", eventId),
    admin
      .from("sponsored_tables")
      .select("tier_id, sponsorships!inner(status)")
      .eq("event_id", eventId)
      .eq("sponsorships.status", "committed"),
  ]);
  if (tiers.error) throw new Error(`loadPledgeTiers tiers failed: ${tiers.error.message}`);
  if (taken.error) throw new Error(`loadPledgeTiers tables failed: ${taken.error.message}`);
  return tiers.data
    .map((t) => ({
      id: t.id,
      name: t.name,
      seat_price_cents: t.seat_price_cents,
      sponsorship_amount_cents: t.sponsorship_amount_cents,
      tables_left: Math.max(t.table_inventory - taken.data.filter((s) => s.tier_id === t.id).length, 0),
    }))
    .sort((a, b) => TIER_ORDER.indexOf(a.name) - TIER_ORDER.indexOf(b.name));
}
