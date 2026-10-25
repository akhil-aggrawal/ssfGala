import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestAppOrigin } from "@/lib/auth/origin";
import type { Database, Json } from "@/lib/database.types";
import { sendSponsorshipConfirmation } from "@/lib/email/sponsorship-confirmation";
import { createEmailTransport } from "@/lib/email/transport";
import { inviteUrl, loadPledgeTiers, newTableInvites, parsePledgeForm, pledgeErrorMessage } from "./pledge";

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
// Prices and the pledged amount come from the database, never the form. The
// server picks each table's id and signs its invite token from it
// (tableInviteToken), so the dashboard can rebuild the link later; only the
// ids and token hashes are sent to the database.
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
  const tokens = newTableInvites(total);
  let next = 0;
  const { data, error } = await call({
    p_event_id: eventId,
    p_display_name: parsed.value.display_name,
    p_email: parsed.value.email,
    p_tables: parsed.value.tables.map(({ tier_id, count }) => ({
      tier_id,
      count,
      table_ids: tokens.slice(next, (next += count)).map((t) => t.id),
    })),
    p_token_hashes: tokens.map((t) => t.hash),
  });
  if (error) return { ok: false, message: pledgeErrorMessage(error) };

  // Tokens follow the order of p_tables, one per table.
  const origin = requestAppOrigin(await headers());
  const tierNames = parsed.value.tables.flatMap((t) => Array<string>(t.count).fill(t.tier_name));
  const saved = data as { sponsorship_id: string; pledged_cents: number };
  const state = {
    ok: true as const,
    pledged_cents: Number(saved.pledged_cents),
    links: tokens.map((t, i) => ({ tier_name: tierNames[i], url: inviteUrl(origin, t.token) })),
  };
  await sendSponsorshipConfirmation(
    admin,
    eventId,
    {
      sponsorshipId: saved.sponsorship_id,
      sponsorEmail: parsed.value.email,
      sponsorName: parsed.value.display_name,
      pledgedCents: state.pledged_cents,
      tables: state.links.map((l) => ({ tierName: l.tier_name, url: l.url })),
    },
    createEmailTransport(),
  );
  return state;
}
