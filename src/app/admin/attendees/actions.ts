"use server";

import { revalidatePath } from "next/cache";
import { attendeeErrorMessage, parseAttendeeEdit, parseAttendeeId } from "@/lib/admin/attendees";
import { requireRole } from "@/lib/auth/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type AttendeeActionState = { ok: boolean; message: string } | null;

const PATH = "/admin/attendees";
const NO_GALA = { ok: false, message: "No active gala. Nothing was saved." };

// Correct an attendee's name and email. The admin check runs first; the SQL
// function scopes the attendee to the admin's active event and writes the
// audit row (before and after) in the same transaction.
export async function updateAttendee(_prev: AttendeeActionState, fd: FormData): Promise<AttendeeActionState> {
  const access = await requireRole("admin", PATH);
  if (access.eventId === null) return NO_GALA;
  const parsed = parseAttendeeEdit(fd);
  if (!parsed.ok) return { ok: false, message: `${parsed.error} Nothing was saved.` };

  const { error } = await createSupabaseAdminClient().rpc("admin_update_attendee", {
    p_actor_id: access.user.id,
    p_event_id: access.eventId,
    p_attendee_id: parsed.value.attendeeId,
    p_full_name: parsed.value.fullName,
    p_email: parsed.value.email,
  });
  if (error) return { ok: false, message: attendeeErrorMessage(error) };
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

// Soft-cancel one attendee: sets cancelled_at, keeps every payment row.
export async function cancelAttendee(_prev: AttendeeActionState, fd: FormData): Promise<AttendeeActionState> {
  const access = await requireRole("admin", PATH);
  if (access.eventId === null) return NO_GALA;
  const attendeeId = parseAttendeeId(fd);
  if (!attendeeId) return { ok: false, message: "Unknown attendee. Nothing was saved." };

  const { error } = await createSupabaseAdminClient().rpc("admin_cancel_attendee", {
    p_actor_id: access.user.id,
    p_event_id: access.eventId,
    p_attendee_id: attendeeId,
  });
  if (error) return { ok: false, message: attendeeErrorMessage(error) };
  revalidatePath(PATH);
  return { ok: true, message: "Cancelled." };
}
