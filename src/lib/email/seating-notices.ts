// Table assignment and cancellation notices (issue #35). Server only.
// Table assignments go out only when an admin clicks Send table assignments;
// there is no free-form message to many attendees. Each email is keyed by
// attendee and table number, so a repeat click inside Resend's 24-hour window
// is dropped and a guest moved to a new table gets the new number. A failed
// send is logged with the attendee id and never undoes the admin's change.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { log } from "@/lib/log";
import { cancellationEmail, tableAssignmentEmail, type GalaEvent } from "./templates";
import type { EmailTransport } from "./transport";

type Db = SupabaseClient<Database>;

export type AssignableGuest = { id: string; fullName: string; email: string; tableNumber: string | null };
export type AssignmentResult = { sent: number; skipped: number; failed: number };

export async function sendTableAssignments(
  event: GalaEvent,
  guests: AssignableGuest[],
  transport: EmailTransport,
): Promise<AssignmentResult> {
  const result: AssignmentResult = { sent: 0, skipped: 0, failed: 0 };
  for (const g of guests) {
    if (!g.tableNumber) {
      result.skipped++;
      continue;
    }
    try {
      await transport.send({
        to: g.email,
        idempotencyKey: `table-assignment:${g.id}:${g.tableNumber}`,
        ...tableAssignmentEmail(event, { name: g.fullName, tableNumber: g.tableNumber }),
      });
      result.sent++;
    } catch (error) {
      result.failed++;
      log("error", "email: send failed", { attendeeId: g.id, kind: "table_assignment", error: String(error) });
    }
  }
  return result;
}

// The gala's name, date and venue for the email body.
export async function loadGalaEvent(db: Db, eventId: string): Promise<GalaEvent> {
  const { data, error } = await db.from("events").select("name, date_at, venue").eq("id", eventId).maybeSingle();
  if (error || !data) throw new Error(`loadGalaEvent failed: ${error?.message ?? "not found"}`);
  return { name: data.name, dateAt: data.date_at, venue: data.venue };
}

// For the cancel Server Action, right after the cancel commits. Never throws;
// the cancellation stands either way.
export async function notifyCancellation(
  db: Db,
  eventId: string,
  attendeeId: string,
  transport: EmailTransport,
): Promise<void> {
  try {
    const { data, error } = await db
      .from("attendees")
      .select("id, full_name, email, events!attendees_event_id_fkey (name, date_at, venue)")
      .eq("id", attendeeId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "attendee not found");
    const event = { name: data.events?.name ?? "", dateAt: data.events?.date_at ?? null, venue: data.events?.venue ?? null };
    await transport.send({
      to: data.email,
      idempotencyKey: `attendee-cancellation:${data.id}`,
      ...cancellationEmail(event, { name: data.full_name }),
    });
  } catch (error) {
    log("error", "email: cancellation notice failed", { attendeeId, error: String(error) });
  }
}
