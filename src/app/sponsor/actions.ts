"use server";

import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth/guard";
import { submitPledge, type PledgeState } from "@/lib/sponsor/submit-pledge";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type { PledgeState };

// Pledge tables for the active gala. Any signed-in user may pledge; the pledge
// makes them a sponsor.
export async function pledgeTables(_prev: PledgeState, formData: FormData): Promise<PledgeState> {
  const access = await getAccess();
  if (!access) redirect("/signin?next=%2Fsponsor");
  if (!access.eventId) return { ok: false, message: "The gala is not taking table pledges right now. Nothing was pledged." };

  const admin = createSupabaseAdminClient();
  return submitPledge(admin, access.eventId, formData, (args) =>
    admin.rpc("pledge_sponsorship", { p_user_id: access.user.id, ...args }),
  );
}
