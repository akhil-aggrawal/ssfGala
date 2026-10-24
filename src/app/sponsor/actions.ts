"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth/guard";
import { appOrigin } from "@/lib/auth/origin";
import {
  inviteUrl,
  loadPledgeTiers,
  newInviteTokens,
  parsePledgeForm,
  pledgeErrorMessage,
} from "@/lib/sponsor/pledge";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type PledgeState =
  | { ok: false; message: string }
  | { ok: true; pledged_cents: number; links: { tier_name: string; url: string }[] }
  | null;

// Pledge tables for the active gala. Any signed-in user may pledge; the pledge
// makes them a sponsor. Prices and the pledged amount come from the database,
// never the form. Raw invite tokens are returned once, for the links; only
// their hashes are stored.
export async function pledgeTables(_prev: PledgeState, formData: FormData): Promise<PledgeState> {
  const access = await getAccess();
  if (!access) redirect("/signin?next=%2Fsponsor");
  if (!access.eventId) return { ok: false, message: "The gala is not taking table pledges right now. Nothing was pledged." };

  const admin = createSupabaseAdminClient();
  const tiers = await loadPledgeTiers(admin, access.eventId);
  const parsed = parsePledgeForm(formData, tiers);
  if (!parsed.ok) return { ok: false, message: `${parsed.error} Nothing was pledged.` };

  const total = parsed.value.tables.reduce((n, t) => n + t.count, 0);
  const tokens = newInviteTokens(total);
  const { data, error } = await admin.rpc("pledge_sponsorship", {
    p_user_id: access.user.id,
    p_event_id: access.eventId,
    p_display_name: parsed.value.display_name,
    p_email: parsed.value.email,
    p_tables: parsed.value.tables.map(({ tier_id, count }) => ({ tier_id, count })),
    p_token_hashes: tokens.map((t) => t.hash),
  });
  if (error) return { ok: false, message: pledgeErrorMessage(error) };

  // Tokens follow the order of p_tables, one per table.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const origin = appOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${host}`);
  const tierNames = parsed.value.tables.flatMap((t) => Array<string>(t.count).fill(t.tier_name));
  return {
    ok: true,
    pledged_cents: Number((data as { pledged_cents: number }).pledged_cents),
    links: tokens.map((t, i) => ({ tier_name: tierNames[i], url: inviteUrl(origin, t.token) })),
  };
}
