"use server";

import { revalidatePath } from "next/cache";
import { loadSeating, parseTableNumber, seatingErrorMessage } from "@/lib/admin/seating";
import { requireRole } from "@/lib/auth/guard";
import { loadGalaEvent, sendTableAssignments as emailTableAssignments } from "@/lib/email/seating-notices";
import { createEmailTransport } from "@/lib/email/transport";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type SeatState = { ok: boolean; message: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared by both actions: admin check first, then the active gala's scope.
// The SQL function changes the row and writes its audit_logs row in one
// transaction, and refuses a row outside that gala.
async function save(
  fn: "set_table_number" | "move_attendee",
  idArg: "p_table_id" | "p_attendee_id",
  formData: FormData,
): Promise<SeatState> {
  const access = await requireRole("admin", "/admin/tables");
  if (access.eventId === null) return { ok: false, message: "No active gala is set up yet. Nothing was saved." };

  const id = formData.get("id")?.toString() ?? "";
  if (!UUID.test(id)) return { ok: false, message: "Unknown table or guest. Nothing was saved." };
  const number = parseTableNumber(formData.get("table_number")?.toString() ?? "");
  if (!number.ok) return { ok: false, message: `${number.error} Nothing was saved.` };

  const args = { p_actor_id: access.user.id, p_event_id: access.eventId, p_number: number.value, [idArg]: id };
  // The two functions take the same arguments apart from idArg.
  const { error } = await createSupabaseAdminClient().rpc(fn, args as never);
  if (error) return { ok: false, message: seatingErrorMessage(error) };

  revalidatePath("/admin/tables");
  return { ok: true, message: "Saved." };
}

// Physical number for a sponsored table; every guest on it shows that number.
export async function setTableNumber(_prev: SeatState, formData: FormData): Promise<SeatState> {
  return save("set_table_number", "p_table_id", formData);
}

// Move one guest: sets only that guest's table. Blank sends them back to
// their sponsored table's number.
export async function moveAttendee(_prev: SeatState, formData: FormData): Promise<SeatState> {
  return save("move_attendee", "p_attendee_id", formData);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Email each active guest with a table number their own table. Takes no
// message text: there is no free-form email to many attendees. Guests with
// no table number are skipped and counted.
export async function sendTableAssignments(): Promise<SeatState> {
  const access = await requireRole("admin", "/admin/tables");
  if (access.eventId === null) return { ok: false, message: "No active gala is set up yet. Nothing was sent." };

  const db = createSupabaseAdminClient();
  const [{ guests }, event] = await Promise.all([loadSeating(db, access.eventId), loadGalaEvent(db, access.eventId)]);
  const { sent, skipped, failed } = await emailTableAssignments(event, guests, createEmailTransport());

  const message = `Sent ${plural(sent, "table assignment")}. Skipped ${plural(skipped, "guest")} without a table number.`;
  if (failed > 0) return { ok: false, message: `${message} ${failed} could not be sent; try again.` };
  return { ok: true, message };
}
