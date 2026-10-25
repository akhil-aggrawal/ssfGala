"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth/guard";
import { guestErrorMessage, parseGuestEdit, parseGuestId } from "@/lib/sponsor/guests";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type GuestState = { ok: boolean; message: string } | null;

// Server Actions are reachable by a direct POST, so each one checks the
// signed-in user and the active gala itself. The SQL function then checks
// that the guest sits on a table this user sponsors in that gala, refuses a
// paid guest's removal, and writes the audit row in the same transaction.
async function signedIn() {
  const access = await getAccess();
  if (!access) redirect("/signin?next=%2Fsponsor%2Fdashboard");
  return access;
}

export async function updateGuest(_prev: GuestState, formData: FormData): Promise<GuestState> {
  const access = await signedIn();
  if (!access.eventId) return { ok: false, message: "The gala is not open right now. Nothing was saved." };
  const parsed = parseGuestEdit(formData);
  if (!parsed.ok) return { ok: false, message: `${parsed.error} Nothing was saved.` };

  const { error } = await createSupabaseAdminClient().rpc("sponsor_update_guest", {
    p_user_id: access.user.id,
    p_event_id: access.eventId,
    p_attendee_id: parsed.value.id,
    p_full_name: parsed.value.full_name,
    p_email: parsed.value.email,
  });
  if (error) return { ok: false, message: guestErrorMessage(error) };

  revalidatePath("/sponsor/dashboard");
  return { ok: true, message: "Saved." };
}

export async function removeGuest(_prev: GuestState, formData: FormData): Promise<GuestState> {
  const access = await signedIn();
  if (!access.eventId) return { ok: false, message: "The gala is not open right now. Nothing was removed." };
  const id = parseGuestId(formData.get("id")?.toString() ?? "");
  if (!id) return { ok: false, message: "Unknown guest. Nothing was removed." };

  const { error } = await createSupabaseAdminClient().rpc("sponsor_remove_guest", {
    p_user_id: access.user.id,
    p_event_id: access.eventId,
    p_attendee_id: id,
  });
  if (error) return { ok: false, message: guestErrorMessage(error) };

  revalidatePath("/sponsor/dashboard");
  return { ok: true, message: "Guest removed." };
}
