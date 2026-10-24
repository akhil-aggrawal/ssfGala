"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guard";
import { parseGalaForm, saveErrorMessage } from "@/lib/gala/setup";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type SaveGalaState = { ok: boolean; message: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Create (no event_id) or edit one gala and its three tiers. The admin check
// runs first; save_gala_setup does the event, tiers and audit row in one
// transaction and refuses a second active gala or an archived one.
export async function saveGala(_prev: SaveGalaState, formData: FormData): Promise<SaveGalaState> {
  const access = await requireRole("admin", "/admin/setup");

  const eventId = formData.get("event_id")?.toString() || undefined;
  if (eventId && !UUID.test(eventId)) return { ok: false, message: "Unknown gala. Nothing was saved." };

  const parsed = parseGalaForm(formData);
  if (!parsed.ok) return { ok: false, message: `${parsed.error} Nothing was saved.` };

  const { error } = await createSupabaseAdminClient().rpc("save_gala_setup", {
    p_actor_id: access.user.id,
    p_event: parsed.value.event,
    p_tiers: parsed.value.tiers,
    p_event_id: eventId,
  });
  if (error) return { ok: false, message: saveErrorMessage(error) };

  revalidatePath("/admin/setup");
  return { ok: true, message: "Saved." };
}
