"use server";

import { revalidatePath } from "next/cache";
import { addAttendeesErrorMessage, parseAddAttendeesForm } from "@/lib/admin/attendees";
import { requireRole } from "@/lib/auth/guard";
import { confirmRegistration } from "@/lib/email/guest-confirmation";
import { createEmailTransport } from "@/lib/email/transport";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type AddAttendeesState = { ok: boolean; message: string } | null;

// Add complimentary or paid-offline attendees to the active gala. The admin
// check runs first and the event comes from the server, never the form.
// add_admin_attendees writes the registration, attendees, offline payment and
// audit row in one transaction. No card is ever charged here. Each attendee
// then gets a confirmation; a failed send never undoes the registration.
export async function addAttendees(_prev: AddAttendeesState, formData: FormData): Promise<AddAttendeesState> {
  const access = await requireRole("admin", "/admin/attendees/new");
  if (access.eventId === null) return { ok: false, message: "No active gala is set up yet. Nothing was saved." };

  const parsed = parseAddAttendeesForm(formData);
  if (!parsed.ok) return { ok: false, message: `${parsed.error} Nothing was saved.` };
  const { kind, tier_id, attendees, amount_cents } = parsed.value;

  const db = createSupabaseAdminClient();
  const { data: registrationId, error } = await db.rpc("add_admin_attendees", {
    p_actor_id: access.user.id,
    p_event_id: access.eventId,
    p_kind: kind,
    p_tier_id: tier_id,
    p_attendees: attendees,
    p_amount_cents: amount_cents ?? undefined,
  });
  if (error) return { ok: false, message: addAttendeesErrorMessage(error) };
  await confirmRegistration(db, registrationId, createEmailTransport());

  revalidatePath("/admin/attendees");
  revalidatePath("/admin");
  const n = attendees.length;
  return { ok: true, message: `Added ${n} attendee${n === 1 ? "" : "s"}.` };
}
