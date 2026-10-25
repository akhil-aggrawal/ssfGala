import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appOrigin } from "@/lib/auth/origin";
import type { Database, Json } from "@/lib/database.types";
import { inviteUrl, loadPledgeTiers, newInviteTokens, parsePledgeForm, pledgeErrorMessage } from "./pledge";

export type PledgeState =
  | { ok: false; message: string }
  | { ok: true; pledged_cents: number; links: { tier_name: string; url: string }[] }
  | null;

export type PledgeArgs = {
  p_event_id: string;
  p_display_name: string;
  p_email: string;
  p_tables: Json;
  p_token_hashes: string[];
};

type PledgeCall = (args: PledgeArgs) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;

// One pledge for the public /sponsor flow and the admin /admin/sponsors flow.
// The caller has already checked who may pledge and passes the RPC to run.
// Prices and the pledged amount come from the database, never the form. Raw
// invite tokens are returned once, for the links; only their hashes are sent.
export async function submitPledge(
  admin: SupabaseClient<Database>,
  eventId: string,
  formData: FormData,
  call: PledgeCall,
): Promise<PledgeState> {
  const tiers = await loadPledgeTiers(admin, eventId);
  const parsed = parsePledgeForm(formData, tiers);
  if (!parsed.ok) return { ok: false, message: `${parsed.error} Nothing was pledged.` };

  const total = parsed.value.tables.reduce((n, t) => n + t.count, 0);
  const tokens = newInviteTokens(total);
  const { data, error } = await call({
    p_event_id: eventId,
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
